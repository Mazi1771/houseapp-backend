const puppeteer = require('puppeteer');

async function scrapeOtodom(url) {
 const browser = await puppeteer.launch(puppeteerConfig);
  
  try {
    const page = await browser.newPage();
    
    // Dodaj losowe opóźnienie między requestami
    await page.setDefaultNavigationTimeout(30000);
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
    
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Pobieranie danych
    const data = await page.evaluate(() => {
      // Funkcje pomocnicze
      const getText = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : '';
      };
      
      const getNumber = (selector) => {
        const text = getText(selector);
        return text ? parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.')) : null;
      };

      // Pobierz wszystkie szczegóły oferty
      const detailsElements = document.querySelectorAll('[data-testid="ad.top-information.table"] > div');
      const details = {};
      detailsElements.forEach(element => {
        const label = element.querySelector('div:first-child')?.textContent.trim();
        const value = element.querySelector('div:last-child')?.textContent.trim();
        if (label && value) {
          details[label] = value;
        }
      });

      return {
        title: getText('[data-cy="adPageHeader.title"]'),
        price: getNumber('[data-cy="adPageHeaderPrice"]'),
        area: getNumber('[aria-label="Powierzchnia"]'),
        rooms: getNumber('[aria-label="Liczba pokoi"]'),
        location: getText('[aria-label="Adres"]'),
        description: getText('[data-cy="adPageDescription"]'),
        details,
        source: 'otodom.pl'
      };
    });

    return data;
  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    throw new Error(`Nie udało się pobrać danych z ${url}: ${error.message}`);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeOtodom };
