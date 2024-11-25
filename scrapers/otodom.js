const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    console.log('Rozpoczynam scrapowanie:', url);
    
    const scrapingApiKey = process.env.SCRAPING_API_KEY;
    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `http://api.scraperapi.com?api_key=${scrapingApiKey}&url=${encodedUrl}&render=true`;

    console.log('Wysyłam request do ScraperAPI');
    const response = await axios.get(apiUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    console.log('HTML załadowany, parsowanie danych...');

    // Funkcja do czyszczenia tekstu z ceny
    const cleanPriceText = (text) => {
      if (!text) return null;
      // Usuń wszystkie spacje i znaki specjalne, zostaw tylko cyfry
      const cleaned = text.replace(/\s+/g, '').replace(/[^\d]/g, '');
      const number = parseInt(cleaned);
      return isNaN(number) ? null : number;
    };

    // Funkcja do czyszczenia tekstu z powierzchni
    const cleanAreaText = (text) => {
      if (!text) return null;
      // Znajdź liczby z przecinkiem lub kropką
      const match = text.match(/([\d\s]+[.,]?\d*)/);
      if (!match) return null;
      // Zamień przecinek na kropkę i usuń spacje
      const cleaned = match[0].replace(',', '.').replace(/\s+/g, '');
      const number = parseFloat(cleaned);
      return isNaN(number) ? null : number;
    };

    // Funkcja do czyszczenia tekstu z liczby pokoi
    const cleanRoomsText = (text) => {
      if (!text) return null;
      const match = text.match(/\d+/);
      if (!match) return null;
      const number = parseInt(match[0]);
      return isNaN(number) ? null : number;
    };

    // Pobieranie tytułu
    const title = $('[data-cy="adPageHeader"]').text().trim() || 
                 $('h1').first().text().trim() || 
                 $('[data-cy="listing-title"]').text().trim();
    console.log('Znaleziony tytuł:', title);

    // Pobieranie ceny - sprawdź różne selektory i formaty
    const priceSelectors = [
      '[data-cy="adPageHeaderPrice"]',
      '[aria-label="Cena"]',
      '.css-8qi9av', // przykładowy selektor Otodom
      'div[data-testid="ad-price-container"]'
    ];

    let priceText;
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        priceText = element.text().trim();
        break;
      }
    }
    const price = cleanPriceText(priceText);
    console.log('Znaleziona cena (tekst):', priceText, 'Przetworzona:', price);

    // Pobieranie powierzchni - sprawdź różne selektory i formaty
    const areaSelectors = [
      '[aria-label="Powierzchnia"]',
      'div:contains("Powierzchnia") + div',
      'div[data-testid="table-value-area"]'
    ];

    let areaText;
    for (const selector of areaSelectors) {
      const element = $(selector).first();
      if (element.length) {
        areaText = element.text().trim();
        break;
      }
    }
    const area = cleanAreaText(areaText);
    console.log('Znaleziona powierzchnia (tekst):', areaText, 'Przetworzona:', area);

    // Pobieranie liczby pokoi - sprawdź różne selektory i formaty
    const roomsSelectors = [
      '[aria-label="Liczba pokoi"]',
      'div:contains("Liczba pokoi") + div',
      'div[data-testid="table-value-rooms_num"]'
    ];

    let roomsText;
    for (const selector of roomsSelectors) {
      const element = $(selector).first();
      if (element.length) {
        roomsText = element.text().trim();
        break;
      }
    }
    const rooms = cleanRoomsText(roomsText);
    console.log('Znaleziona liczba pokoi (tekst):', roomsText, 'Przetworzona:', rooms);

    // Pobieranie lokalizacji
    const location = $('[aria-label="Adres"]').first().text().trim() ||
                    $('[data-cy="adPageHeaderLocation"]').first().text().trim() ||
                    $('div[data-testid="ad-header-location"]').text().trim();
    console.log('Znaleziona lokalizacja:', location);

    // Pobieranie opisu
    const description = $('[data-cy="adPageDescription"]').text().trim() ||
                       $('.eo9qioj1').text().trim() ||
                       $('div[data-testid="ad-description"]').text().trim();
    console.log('Znaleziony opis (fragment):', description?.substring(0, 100));

    const result = {
      title: title || null,
      price: price || null,
      area: area || null,
      rooms: rooms || null,
      location: location || '',
      description: description || '',
      sourceUrl: url,
      source: 'otodom'
    };

    console.log('Końcowe dane:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    return {
      title: url.split('/').pop(),
      price: null,
      area: null,
      rooms: null,
      location: '',
      description: '',
      sourceUrl: url,
      source: 'otodom'
    };
  }
}

module.exports = { scrapeOtodom };
