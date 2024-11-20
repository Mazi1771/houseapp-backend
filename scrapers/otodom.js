const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Debug: Wydrukuj wszystkie znalezione elementy
    $('div').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('m²') || text.includes('zł') || text.includes('pokoje')) {
        console.log('Found relevant text:', text);
      }
    });

    // Funkcje pomocnicze
    const getText = (selector) => {
      const element = $(selector);
      const text = element.length ? element.text().trim() : '';
      console.log(`Getting text for ${selector}:`, text);
      return text;
    };
    
    const getNumber = (text) => {
      if (!text) return null;
      console.log('Processing number from:', text);
      const match = text.match(/\d+([.,]\d+)?/);
      if (match) {
        console.log('Found number:', match[0]);
        return parseFloat(match[0].replace(',', '.'));
      }
      return null;
    };

    // Szukamy elementów po zawartości tekstu
    let areaText = '';
    let roomsText = '';
    let priceText = '';
    let locationText = '';

    $('div').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('m²') && !areaText) areaText = text;
      if (text.includes('pokoj') && !roomsText) roomsText = text;
      if (text.includes('zł') && !priceText) priceText = text;
      if (text.includes('ul.') || text.includes('Warszawa')) locationText = text;
    });

    console.log('Found texts:', { areaText, roomsText, priceText, locationText });

    const data = {
      title: getText('h1'),
      price: getNumber(priceText),
      area: getNumber(areaText),
      rooms: getNumber(roomsText),
      location: locationText,
      description: getText('div[data-cy="adPageDescription"]'),
      details: {},
      source: 'otodom.pl'
    };

    // Zbieramy szczegóły
    $('div').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      if (text.includes(':')) {
        const [label, value] = text.split(':').map(t => t.trim());
        if (label && value) {
          data.details[label] = value;
        }
      }
    });

    console.log('Final data:', data);
    return data;

  } catch (error) {
    console.error('Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message
    });
    throw new Error(`Nie udało się pobrać danych z ${url}: ${error.message}`);
  }
}

module.exports = { scrapeOtodom };
