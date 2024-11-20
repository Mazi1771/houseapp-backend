const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    const apiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true`;
    const response = await axios.get(apiUrl);
    const $ = cheerio.load(response.data);
    
    // Log all divs for debugging
    $('div').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('m²') || text.includes('pokoi') || text.includes('zł')) {
        console.log('Found relevant text:', text);
      }
    });

    const findText = (keywords) => {
      let result = null;
      $('div').each((i, el) => {
        const text = $(el).text().trim();
        if (keywords.some(keyword => text.includes(keyword)) && !result) {
          result = text;
        }
      });
      return result;
    };

    const title = $('h1').text().trim();
    const priceText = findText(['zł', 'PLN']);
    const areaText = findText(['m²', 'metrów']);
    const roomsText = findText(['pokoi', 'pokoje']);
    const locationText = findText(['ul.', 'ulica', 'Warszawa']);
    const descriptionText = $('[data-cy="adPageDescription"], .description').text().trim();

    console.log({ priceText, areaText, roomsText }); // Debug log

    return {
      title,
      price: extractNumber(priceText),
      area: extractNumber(areaText),
      rooms: extractNumber(roomsText),
      location: locationText || '',
      description: descriptionText,
      source: 'otodom.pl'
    };
  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  }
}

function extractNumber(text) {
  if (!text) return null;
  const match = text.match(/\d+([.,]\d+)?/);
  return match ? parseFloat(match[0].replace(',', '.')) : null;
}

module.exports = { scrapeOtodom };
