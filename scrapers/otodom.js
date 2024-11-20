const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    // Dodajemy parametr render=true do scraperapi
    const apiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true&wait_for=.css-1ccovha`;
    const response = await axios.get(apiUrl);
    const $ = cheerio.load(response.data);

    // Szukamy konkretnych danych w strukturze strony
    const title = $('h1').first().text().trim();
    const priceElement = $('div').filter((i, el) => $(el).text().includes('zł/m²')).first();
    const price = extractPrice(priceElement.text());
    
    const details = {};
    $('.css-1ccovha').each((i, el) => {
      const $el = $(el);
      const label = $el.find('div:first').text().trim();
      const value = $el.find('div:last').text().trim();
      details[label] = value;
    });

    const area = extractNumber(details['Powierzchnia'] || '');
    const rooms = extractNumber(details['Liczba pokoi'] || '');

    return {
      title,
      price,
      area,
      rooms,
      location: details['Lokalizacja'] || '',
      description: $('[data-cy="adPageDescription"]').text().trim(),
      details,
      source: 'otodom.pl'
    };
  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  }
}

function extractPrice(text) {
  const match = text.match(/(\d+[\d\s]*(\d+)?)/);
  if (match) {
    return parseFloat(match[0].replace(/\s/g, ''));
  }
  return null;
}

function extractNumber(text) {
  const match = text.match(/(\d+([.,]\d+)?)/);
  return match ? parseFloat(match[0].replace(',', '.')) : null;
}

module.exports = { scrapeOtodom };
