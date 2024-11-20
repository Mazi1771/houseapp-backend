const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    // Używamy Browser API z większym timeoutem i renderowaniem JavaScript
    const apiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true&wait_for=[data-cy="adPageHeaderPrice"]`;
    
    const response = await axios.get(apiUrl, {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    
    // Zapisujemy pełny HTML do debugowania
    console.log('Page HTML:', response.data);

    // Szukamy ceny w różnych formatach
    const priceSelectors = [
      '[data-cy="adPageHeaderPrice"]',
      '.css-8qi9av',
      'div:contains("zł")'
    ];

    let price = null;
    for (const selector of priceSelectors) {
      const element = $(selector);
      if (element.length) {
        const text = element.text().trim();
        const match = text.match(/(\d+[\s.,]*)+/);
        if (match) {
          price = parseFloat(match[0].replace(/\s/g, '').replace(',', '.'));
          break;
        }
      }
    }

    // Szukamy powierzchni i pokoi w tekście strony
    const areaMatch = response.data.match(/(\d+([.,]\d+)?)\s*m²/);
    const roomsMatch = response.data.match(/(\d+)\s*pok/);

    return {
      title: $('h1').first().text().trim(),
      price: price,
      area: areaMatch ? parseFloat(areaMatch[1].replace(',', '.')) : null,
      rooms: roomsMatch ? parseInt(roomsMatch[1]) : null,
      location: $('[aria-label="Adres"]').text().trim(),
      description: $('[data-cy="adPageDescription"]').text().trim(),
      source: 'otodom.pl'
    };
  } catch (error) {
    console.error('Scraping error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

module.exports = { scrapeOtodom };
