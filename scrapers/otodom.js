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
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Funkcje pomocnicze
    const getText = (selector) => {
      const element = $(selector);
      return element.length ? element.text().trim() : '';
    };
    
    const getNumber = (text) => {
      return text ? parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.')) : null;
    };

    // Pobieranie danych
    const priceText = $('[data-cy="adPageHeaderPrice"]').text();
    const areaText = $('[aria-label="Powierzchnia"]').text();
    const roomsText = $('[aria-label="Liczba pokoi"]').text();

    const data = {
      title: $('[data-cy="adPageHeader.title"]').text().trim(),
      price: getNumber(priceText),
      area: getNumber(areaText),
      rooms: getNumber(roomsText),
      location: $('[aria-label="Adres"]').text().trim(),
      description: $('[data-cy="adPageDescription"]').text().trim(),
      details: {},
      source: 'otodom.pl'
    };

    // Pobieranie szczegółów
    $('[data-testid="ad.top-information.table"] > div').each((i, element) => {
      const label = $(element).find('div:first-child').text().trim();
      const value = $(element).find('div:last-child').text().trim();
      if (label && value) {
        data.details[label] = value;
      }
    });

    console.log('Pobrane dane:', data); // Dodajemy log
    return data;

  } catch (error) {
    console.error('Szczegóły błędu:', error.response?.status, error.response?.statusText);
    throw new Error(`Nie udało się pobrać danych z ${url}: ${error.message}`);
  }
}

module.exports = { scrapeOtodom };
