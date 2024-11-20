const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // Funkcje pomocnicze
    const getText = (selector) => {
      const element = $(selector);
      return element.length ? element.text().trim() : '';
    };
    
    const getNumber = (selector) => {
      const text = getText(selector);
      return text ? parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.')) : null;
    };

    // Pobieranie danych
    const data = {
      title: getText('h1.css-1wnihf5'),
      price: getNumber('strong.css-1i5yyw0'),
      location: getText('a.css-1qz7z11'),
      description: getText('div.css-1t507yq'),
      details: {},
      source: 'otodom.pl'
    };

    // Pobierz szczegóły
    $('.css-1ccovha').each((i, element) => {
      const label = $(element).find('.css-1ccovha').text().trim();
      const value = $(element).find('.css-1wi2w6s').text().trim();
      if (label && value) {
        data.details[label] = value;
      }
    });

    return data;
  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    throw new Error(`Nie udało się pobrać danych z ${url}: ${error.message}`);
  }
}

module.exports = { scrapeOtodom };
