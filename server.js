// 1. IMPORTY
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

// 2. INICJALIZACJA EXPRESS I MIDDLEWARE
const app = express();

// Konfiguracja CORS
const allowedOrigins = [
  'https://houseapp-uhmg.vercel.app',
  'https://houseapp-uhmg-git-main-barteks-projects.vercel.app',
  'https://houseapp-uhmg-*-barteks-projects.vercel.app',
  'http://localhost:3000'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const regex = new RegExp('^' + allowedOrigin.replace('*', '.*') + '$');
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('Niedozwolony origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 3. POŁĄCZENIE Z MONGODB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// 4. MODELE
const PriceHistorySchema = new mongoose.Schema({
  price: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});

const PropertySchema = new mongoose.Schema({
  title: String,
  price: { type: Number, default: null },
  priceHistory: [PriceHistorySchema],
  area: { type: Number, default: null },
  plotArea: { type: Number, default: null },
  rooms: { type: Number, default: null },
  location: { type: String, default: '' },
  description: { type: String, default: '' },
  status: {
    type: String,
    enum: ['wybierz', 'do zamieszkania', 'do remontu', 'w budowie', 'stan deweloperski'],
    default: 'wybierz'
  },
  rating: {
    type: String,
    enum: ['favorite', 'interested', 'not_interested', null],
    default: null
  },
  details: { type: Object, default: {} },
  source: String,
  sourceUrl: String,
  board: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true
  },
  edited: { type: Boolean, default: false },
  lastChecked: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  boards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board'
  }],
  createdAt: { type: Date, default: Date.now }
});

const BoardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  shared: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['viewer', 'editor'],
      default: 'viewer'
    }
  }],
  properties: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property'
  }],
  isPrivate: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Board = mongoose.model('Board', BoardSchema);
const Property = mongoose.model('Property', PropertySchema);

// 5. MIDDLEWARE AUTORYZACJI
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decoded.userId });

    if (!user) {
      throw new Error('Nie znaleziono użytkownika');
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Proszę się zalogować' });
  }
};

// 6. FUNKCJE POMOCNICZE
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

    // Debug: Zapisz wszystkie dane z parametrów
    let allParameters = {};
    $('.css-1ccovha').each((_, element) => {
      const label = $(element).find('div:first-child').text().trim();
      const value = $(element).find('div:last-child').text().trim();
      allParameters[label] = value;
      console.log(`Znaleziono parametr: ${label} = ${value}`);
    });

    // Tytuł
    const title = $('h1').first().text().trim();
    console.log('Tytuł:', title);

    // Cena
    let priceText = $('[data-cy="adPageHeaderPrice"]').first().text().trim() ||
                    $('[aria-label="Cena"]').first().text().trim();
    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;
    console.log('Cena:', price, 'z tekstu:', priceText);

    // Powierzchnia
    let area = null;
    Object.entries(allParameters).forEach(([key, value]) => {
      if (key.toLowerCase().includes('powierzchnia') && !key.toLowerCase().includes('działki')) {
        const match = value.match(/(\d+(?:[,.]\d+)?)\s*m²/);
        if (match) {
          area = parseFloat(match[1].replace(',', '.'));
        }
      }
    });
    console.log('Powierzchnia:', area);

    // Pokoje
    let rooms = null;
    Object.entries(allParameters).forEach(([key, value]) => {
      if (key.toLowerCase().includes('liczba pokoi')) {
        const match = value.match(/\d+/);
        if (match) {
          rooms = parseInt(match[0]);
        }
      }
    });
    console.log('Pokoje:', rooms);

    // Lokalizacja
    let location = '';
    const locationElements = [
      '[data-testid="location-name"]',
      '.css-17o5lod',
      '[data-testid="ad-header-location"]'
    ].map(selector => $(selector).first().text().trim()).filter(Boolean);

    if (locationElements.length > 0) {
      location = locationElements[0];
    } else {
      const breadcrumbs = $('[data-cy="breadcrumbs-link"]')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => !text.includes('Ogłoszenia') && !text.includes('Nieruchomości'));
      
      if (breadcrumbs.length > 0) {
        location = breadcrumbs.join(', ');
      }
    }
    console.log('Lokalizacja:', location);

    // Opis
    const description = $('[data-cy="adPageDescription"]').first().text().trim();

    const result = {
      title: title || '',
      price,
      area,
      rooms,
      location,
      description: description || '',
      sourceUrl: url,
      source: 'otodom'
    };

    console.log('Końcowe dane:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    throw error;
  }
}

// 7. ENDPOINTY

// Endpoint testowy
app.get('/', (req, res) => {
  res.json({ message: 'API działa!' });
});

// Rejestracja
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Użytkownik z tym emailem już istnieje' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      email,
      password: hashedPassword,
      name
    });

    await user.save();

    const defaultBoard = new Board({
      name: 'Moja tablica',
      owner: user._id,
      isPrivate: true
    });

    await defaultBoard.save();

    user.boards.push(defaultBoard._id);
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logowanie
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scraping
app.post('/api/scrape', auth, async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || !url.includes('otodom.pl')) {
      return res.status(400).json({ error: 'Nieprawidłowy URL. Musi być z serwisu Otodom.' });
    }

    const defaultBoard = await Board.findOne({ owner: req.user._id });
    if (!defaultBoard) {
      return res.status(404).json({ error: 'Nie znaleziono domyślnej tablicy' });
    }

    console.log('Rozpoczynam scrapowanie URL:', url);
    const scrapedData = await scrapeOtodom(url);
    console.log('Pobrane dane:', scrapedData);

    const property = new Property({
      ...scrapedData,
      board: defaultBoard._id,
      status: 'wybierz'
    });

    await property.save();
    defaultBoard.properties.push(property._id);
    await defaultBoard.save();

    res.json(property);
  } catch (error) {
    console.error('Błąd w endpoincie /api/scrape:', error);
    res.status(500).json({
      error: 'Wystąpił błąd podczas pobierania danych',
      details: error.message
    });
  }
});

// Pobieranie właściwości
app.get('/api/properties', auth, async (req, res) => {
  try {
    const boards = await Board.find({
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id }
      ]
    });

    const boardIds = boards.map(board => board._id);
    const properties = await Property.find({ board: { $in: boardIds } });
    res.json(properties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aktualizacja właściwości
app.put('/api/properties/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOneAndUpdate(
      {
        _id: req.params.id,
        board: { $in: req.user.boards }
      },
      {
        ...req.body,
        updatedAt: Date.now(),
        edited: true
      },
      { new: true }
    );

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    res.json(property);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Usuwanie właściwości
app.delete('/api/properties/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    await Board.updateOne(
      { _id: property.board },
      { $pull: { properties: property._id } }
    );

    await Property.deleteOne({ _id: req.params.id });
    res.json({ message: 'Nieruchomość została usunięta' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Aktualizacja cen
app.post('/api/update-prices', auth, async (req, res) => {
  try {
    console.log('Rozpoczynam ręczną aktualizację cen...');
    const properties = await Property.find({
      sourceUrl: { $exists: true, $ne: '' }
    });

    const updates = [];
    for (const property of properties) {
      try {
        console.log(`Sprawdzam aktualizację dla: ${property.title}`);
        const scrapedData = await scrapeOtodom(property.sourceUrl);
        
        if (scrapedData.price && scrapedData.price !== property.price) {
          console.log(`Znaleziono nową cenę dla ${property.title}: ${scrapedData.price} (było: ${property.price})`);
          
          // Dodaj starą cenę do historii
          if (!property.priceHistory) property.priceHistory = [];
          property.priceHistory.push({
            price: property.price,
            date: new Date()
          });

          // Aktualizuj cenę
          property.price = scrapedData.price;
          property.lastChecked = new Date();
          await property.save();
          
          updates.push({
            id: property._id,
            title: property.title,
            oldPrice: property.price,
            newPrice: scrapedData.price
          });
        }
      } catch (error) {
        console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
      }
    }

    console.log(`Zakończono aktualizację. Zaktualizowano ${updates.length} ogłoszeń`);
    res.json({ 
      success: true, 
      updatedCount: updates.length,
      updates 
    });
  } catch (error) {
    console.error('Błąd podczas aktualizacji cen:', error);
    res.status(500).json({ error: 'Błąd podczas aktualizacji cen' });
  }
});

// Zadanie cron do automatycznej aktualizacji cen
if (cron) {
  cron.schedule('5 0 * * *', async () => {
    try {
      console.log('Rozpoczynam zaplanowaną aktualizację cen...');
      
      const properties = await Property.find({
        sourceUrl: { $exists: true, $ne: '' }
      });

      console.log(`Znaleziono ${properties.length} ogłoszeń do sprawdzenia`);

      for (const property of properties) {
        try {
          const scrapedData = await scrapeOtodom(property.sourceUrl);
          
          if (scrapedData.price && scrapedData.price !== property.price) {
            console.log(`Aktualizacja ceny dla ${property.title}: ${property.price} -> ${scrapedData.price}`);
            
            if (!property.priceHistory) property.priceHistory = [];
            property.priceHistory.push({
              price: property.price,
              date: new Date()
            });

            property.price = scrapedData.price;
            property.lastChecked = new Date();
            await property.save();
          }
        } catch (error) {
          console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
        }
      }

      console.log('Zakończono zaplanowaną aktualizację cen');
    } catch (error) {
      console.error('Błąd podczas zaplanowanej aktualizacji:', error);
    }
  });
}

// Historia cen
app.get('/api/properties/:id/price-history', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    const priceHistory = [
      // Dodaj pierwotną cenę jako pierwszy punkt
      {
        price: property.price,
        date: property.createdAt
      },
      // Dodaj pozostałe punkty z historii
      ...(property.priceHistory || [])
    ];

    res.json(priceHistory);
  } catch (error) {
    console.error('Błąd podczas pobierania historii cen:', error);
    res.status(500).json({ error: error.message });
  }
});

// Uruchomienie serwera
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
});
