const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'Cache-Control': 'max-age=0'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Dodajmy logowanie HTML do debugowania
    console.log('HTML strony:', response.data);

    // Funkcje pomocnicze
    const getText = (selector) => {
      const element = $(selector);
      const text = element.length ? element.text().trim() : '';
      console.log(`Selector ${selector}:`, text); // Debug log
      return text;
    };
    
    const getNumber = (text) => {
      if (!text) return null;
      const numbers = text.match(/\d+([.,]\d+)?/);
      return numbers ? parseFloat(numbers[0].replace(',', '.')) : null;
    };

    // Próbujmy różnych selektorów
    const title = getText('h1') || getText('.css-1wnihf5') || getText('[data-cy="adPageHeader.title"]');
    const priceText = getText('.css-8qi9av') || getText('[data-cy="adPageHeaderPrice"]');
    const areaText = getText('.css-1gi2yjx:contains("Powierzchnia")') || getText('[aria-label="Powierzchnia"]');
    const roomsText = getText('.css-1gi2yjx:contains("Liczba pokoi")') || getText('[aria-label="Liczba pokoi"]');
    const locationText = getText('.css-1si1nqs') || getText('[aria-label="Adres"]');
    const descriptionText = getText('.css-1t507yq') || getText('[data-cy="adPageDescription"]');

    const data = {
      title,
      price: getNumber(priceText),
      area: getNumber(areaText),
      rooms: getNumber(roomsText),
      location: locationText,
      description: descriptionText,
      details: {},
      source: 'otodom.pl'
    };

    // Zbieramy wszystkie szczegóły
    $('.css-1ccovha, [data-testid="ad.top-information.table"] > div').each((i, element) => {
      const label = $(element).find('div:first').text().trim();
      const value = $(element).find('div:last').text().trim();
      if (label && value) {
        data.details[label] = value;
        console.log(`Detail ${label}:`, value); // Debug log
      }
    });

    console.log('Pobrane dane:', data);
    return data;

  } catch (error) {
    console.error('Szczegóły błędu:', error.response?.status, error.response?.statusText);
    console.error('Error stack:', error.stack);
    throw new Error(`Nie udało się pobrać danych z ${url}: ${error.message}`);
  }
}

module.exports = { scrapeOtodom };
