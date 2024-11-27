const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();

// Lista dozwolonych origin'ów
const allowedOrigins = [
  'https://houseapp-uhmg.vercel.app',
  'https://houseapp-uhmg-git-main-barteks-projects.vercel.app',
  'https://houseapp-uhmg-*-barteks-projects.vercel.app',
  'http://localhost:3000'
];

// Konfiguracja CORS
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
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600
}));

app.options('*', cors());
app.use(express.json());

// Konfiguracja MongoDB
mongoose.connection.on('connected', () => {
  console.log('MongoDB połączone pomyślnie');
});

mongoose.connection.on('error', (err) => {
  console.error('Błąd połączenia MongoDB:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB rozłączone');
});

// Funkcja połączenia z MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    console.log('Próba połączenia z MongoDB...');
    console.log('URI present:', !!mongoURI);

    if (!mongoURI) {
      throw new Error('Brak MONGODB_URI w zmiennych środowiskowych');
    }

    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });

    console.log('Połączenie z MongoDB ustanowione');
  } catch (err) {
    console.error('Błąd podczas łączenia z MongoDB:', err);
    setTimeout(connectDB, 5000);
  }
};

// Inicjalizacja połączenia
connectDB();

// Automatyczne ponowne połączenie
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB rozłączone - próba ponownego połączenia...');
  setTimeout(connectDB, 5000);
});
// Schematy
const PriceHistorySchema = new mongoose.Schema({
  price: { type: Number, required: true },
  date: { type: Date, default: Date.now }
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

const PropertySchema = new mongoose.Schema({
  title: String,
  price: { type: Number, default: null, required: false },
  priceHistory: [PriceHistorySchema],
  area: { type: Number, default: null, required: false },
  plotArea: { type: Number, default: null, required: false },
  rooms: { type: Number, default: null, required: false },
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
  isActive: { type: Boolean, default: true },
  lastChecked: { type: Date, default: Date.now },
  details: { type: Object, default: {} },
  source: String,
  sourceUrl: String,
  board: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true
  },
  edited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Modele
const User = mongoose.model('User', UserSchema);
const Board = mongoose.model('Board', BoardSchema);
const Property = mongoose.model('Property', PropertySchema);

// Middleware autoryzacji
const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    console.log('Auth header:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Brak tokenu autoryzacji');
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('Token otrzymany:', token ? 'Jest' : 'Brak');

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token zdekodowany:', decoded);

      const user = await User.findOne({ _id: decoded.userId });
      if (!user) {
        throw new Error('Nie znaleziono użytkownika');
      }

      req.user = user;
      req.token = token;
      next();
    } catch (error) {
      console.error('Błąd weryfikacji tokenu:', error);
      throw new Error('Token nieprawidłowy lub wygasł');
    }
  } catch (error) {
    console.error('Błąd autoryzacji:', error.message);
    res.status(401).json({ 
      error: 'Proszę się zalogować', 
      details: error.message 
    });
  }
};
// Funkcja scrapowania
async function scrapeOtodom(url) {
  try {
    console.log('Rozpoczynam scrapowanie:', url);
    
    const scrapingApiKey = process.env.SCRAPING_API_KEY;
    if (!scrapingApiKey) {
      throw new Error('Brak klucza API do scrapingu');
    }

    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `http://api.scraperapi.com?api_key=${scrapingApiKey}&url=${encodedUrl}&render=true`;

    console.log('Wysyłam request do ScraperAPI');
    const response = await axios.get(apiUrl, {
      timeout: 30000,
      headers: {
        'Accept-Language': 'pl-PL'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Debug: zapisz pierwsze 1000 znaków HTML
    console.log('Otrzymany HTML:', html.substring(0, 1000));

    // Szukanie parametrów w różnych formatach
    const parameterContainers = [
      '.css-1ccovha',    // Stary format
      '[data-testid="ad-details-table"] > div', // Nowy format
      '.css-kos6vh',     // Dodatkowy format
      '.css-1k6nwej'     // Jeszcze jeden format
    ];

    let allParameters = {};
    
    parameterContainers.forEach(selector => {
      $(selector).each((_, element) => {
        // Próbujemy różne struktury
        let label, value;

        // Struktura 1: div > div (label) + div (value)
        const divs = $(element).find('div');
        if (divs.length >= 2) {
          label = $(divs[0]).text().trim();
          value = $(divs[1]).text().trim();
        }

        // Struktura 2: data-testid="table-value" i "table-label"
        if (!label || !value) {
          const labelEl = $(element).find('[data-testid="table-label"]');
          const valueEl = $(element).find('[data-testid="table-value"]');
          if (labelEl.length && valueEl.length) {
            label = labelEl.text().trim();
            value = valueEl.text().trim();
          }
        }

        if (label && value) {
          allParameters[label] = value;
          console.log(`Znaleziono parametr: ${label} = ${value}`);
        }
      });
    });

    // Szukanie podstawowych informacji
    const title = $('h1').first().text().trim() ||
                 $('[data-testid="ad-title"]').first().text().trim() ||
                 $('[data-cy="adPageHeader"]').first().text().trim();

    // Szukanie ceny
    let priceText = '';
    const priceSelectors = [
      '[data-testid="price"]',
      '[data-cy="adPageHeaderPrice"]',
      '.css-8qi9av',
      '.css-t3wmkv',
      '.css-1vr19r7'
    ];

    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        priceText = element.text().trim();
        break;
      }
    }

    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;

    // Szukanie powierzchni i pokoi w parametrach
    let area = null;
    let rooms = null;
    let plotArea = null;

    Object.entries(allParameters).forEach(([key, value]) => {
      const keyLower = key.toLowerCase();
      // Powierzchnia
      if (keyLower.includes('powierzchnia') && !keyLower.includes('działki') && !keyLower.includes('dzialki')) {
        const match = value.match(/(\d+[.,]?\d*)/);
        if (match) {
          area = parseFloat(match[1].replace(',', '.'));
        }
      }
      // Powierzchnia działki
      else if (keyLower.includes('działki') || keyLower.includes('dzialki') || keyLower.includes('działka') || keyLower.includes('dzialka')) {
        const match = value.match(/(\d+[.,]?\d*)/);
        if (match) {
          plotArea = parseFloat(match[1].replace(',', '.'));
        }
      }
      // Pokoje
      else if (keyLower.includes('pokoi') || keyLower.includes('pokoje') || keyLower.includes('liczba pokoi')) {
        const match = value.match(/(\d+)/);
        if (match) {
          rooms = parseInt(match[1]);
        }
      }
    });

    // Szukanie lokalizacji
    const locationSelectors = [
      '[data-testid="location-name"]',
      '[data-testid="ad-header-location"]',
      '.css-17o5lod',
      '[aria-label="Adres"]'
    ];

    let location = '';
    for (const selector of locationSelectors) {
      const element = $(selector).first();
      if (element.length) {
        location = element.text().trim();
        break;
      }
    }

    // Jeśli nie znaleziono lokalizacji w podstawowych selektorach, szukaj w breadcrumbach
    if (!location) {
      const breadcrumbs = $('[data-cy="breadcrumbs-link"]')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => !text.includes('Ogłoszenia') && !text.includes('Nieruchomości'));
      
      if (breadcrumbs.length > 0) {
        location = breadcrumbs.join(', ');
      }
    }

    // Pobieranie opisu
    const description = $('[data-cy="adPageDescription"]').first().text().trim() ||
                       $('[data-testid="ad-description"]').first().text().trim();

    const result = {
      title: title || 'Brak tytułu',
      price,
      area,
      plotArea,
      rooms,
      location: location || 'Brak lokalizacji',
      description: description || '',
      sourceUrl: url,
      source: 'otodom',
      parameters: allParameters // Zachowujemy wszystkie parametry do debugowania
    };

    console.log('Wynik scrapowania:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    throw error;
  }
}
// Endpoint testowy
app.get('/', (req, res) => {
  res.json({ message: 'API działa!' });
});

// ===== AUTORYZACJA =====
// Rejestracja
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email i hasło są wymagane',
        fields: { email: !email, password: !password }
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Użytkownik z tym emailem już istnieje' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0]
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
    console.error('Błąd podczas rejestracji:', error);
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

// ===== NIERUCHOMOŚCI =====
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
    const properties = await Property.find({ board: { $in: boardIds } })
      .sort({ createdAt: -1 });

    res.set('Cache-Control', 'no-cache');
    res.json(properties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scraping nowej nieruchomości
app.post('/api/scrape', auth, async (req, res) => {
  try {
    const { url } = req.body;
    console.log('Otrzymany URL:', url);
    
    if (!url || !url.includes('otodom.pl')) {
      return res.status(400).json({ error: 'Nieprawidłowy URL. Musi być z serwisu Otodom.' });
    }

    const defaultBoard = await Board.findOne({ owner: req.user._id });
    if (!defaultBoard) {
      return res.status(404).json({ error: 'Nie znaleziono domyślnej tablicy' });
    }

    console.log('Rozpoczynam scrapowanie...');
    const scrapedData = await scrapeOtodom(url);
    console.log('Pobrane dane:', scrapedData);

    const property = new Property({
      ...scrapedData,
      board: defaultBoard._id,
      status: 'wybierz',
      edited: false,
      lastChecked: new Date()
    });

    await property.save();
    defaultBoard.properties.push(property._id);
    await defaultBoard.save();

    res.json(property);
  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    res.status(500).json({
      error: 'Wystąpił błąd podczas pobierania danych',
      details: error.message
    });
  }
});

// Aktualizacja właściwości
app.put('/api/properties/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    if (req.body.price && req.body.price !== property.price) {
      if (!property.priceHistory) property.priceHistory = [];
      property.priceHistory.push({
        price: property.price,
        date: new Date()
      });
    }

    Object.assign(property, req.body, {
      updatedAt: new Date(),
      edited: true
    });

    await property.save();
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
      {
        price: property.price,
        date: property.createdAt
      },
      ...(property.priceHistory || [])
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(priceHistory);
  } catch (error) {
    console.error('Błąd podczas pobierania historii cen:', error);
    res.status(500).json({ error: error.message });
  }
});

// Odświeżanie pojedynczej nieruchomości
app.post('/api/properties/:id/refresh', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property || !property.sourceUrl) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona lub brak źródłowego URL' });
    }

    const scrapedData = await scrapeOtodom(property.sourceUrl);
    
    if (!scrapedData.price) {
      property.isActive = false;
      property.lastChecked = new Date();
      await property.save();
      return res.json({ 
        message: 'Oferta nieaktywna',
        property 
      });
    }

    if (scrapedData.price !== property.price) {
      if (!property.priceHistory) property.priceHistory = [];
      property.priceHistory.push({
        price: property.price,
        date: new Date()
      });
    }

    property.price = scrapedData.price;
    property.isActive = true;
    property.lastChecked = new Date();
    await property.save();

    res.json({ 
      message: 'Aktualizacja zakończona pomyślnie',
      property
    });
  } catch (error) {
    console.error('Błąd podczas aktualizacji:', error);
    res.status(500).json({ error: error.message });
  }
});

// Odświeżanie wszystkich nieruchomości
app.post('/api/properties/refresh-all', auth, async (req, res) => {
  try {
    const boards = await Board.find({
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id }
      ]
    });

    const boardIds = boards.map(board => board._id);
    const properties = await Property.find({ 
      board: { $in: boardIds },
      sourceUrl: { $exists: true, $ne: '' }
    });

    const updates = [];
    const errors = [];

    for (const property of properties) {
      try {
        const scrapedData = await scrapeOtodom(property.sourceUrl);
        
        if (!scrapedData.price) {
          property.isActive = false;
          property.lastChecked = new Date();
          await property.save();
          updates.push({ id: property._id, status: 'inactive' });
          continue;
        }

        if (scrapedData.price !== property.price) {
          if (!property.priceHistory) property.priceHistory = [];
          property.priceHistory.push({
            price: property.price,
            date: new Date()
          });
        }

        property.price = scrapedData.price;
        property.isActive = true;
        property.lastChecked = new Date();
        await property.save();

        updates.push({ 
          id: property._id, 
          status: 'updated',
          oldPrice: property.price,
          newPrice: scrapedData.price
        });

      } catch (error) {
        console.error(`Błąd podczas aktualizacji ${property._id}:`, error);
        errors.push({ id: property._id, error: error.message });
      }
    }

    res.json({ 
      success: true, 
      updated: updates.length,
      updates,
      errors
    });

  } catch (error) {
    console.error('Błąd podczas aktualizacji wszystkich nieruchomości:', error);
    res.status(500).json({ error: error.message });
  }
});
// Automatyczna aktualizacja co 24h
if (cron) {
  cron.schedule('0 3 * * *', async () => {
    console.log('Rozpoczynam zaplanowaną aktualizację nieruchomości...');
    try {
      const properties = await Property.find({
        sourceUrl: { $exists: true, $ne: '' }
      });

      for (const property of properties) {
        try {
          const scrapedData = await scrapeOtodom(property.sourceUrl);
          
          if (!scrapedData.price) {
            property.isActive = false;
            property.lastChecked = new Date();
            await property.save();
            continue;
          }

          if (scrapedData.price !== property.price) {
            if (!property.priceHistory) property.priceHistory = [];
            property.priceHistory.push({
              price: property.price,
              date: new Date()
            });
          }

          property.price = scrapedData.price;
          property.isActive = true;
          property.lastChecked = new Date();
          await property.save();

        } catch (error) {
          console.error(`Błąd podczas aktualizacji ${property._id}:`, error);
          property.isActive = false;
          property.lastChecked = new Date();
          await property.save();
        }
      }

      console.log('Zakończono zaplanowaną aktualizację nieruchomości');
    } catch (error) {
      console.error('Błąd podczas zaplanowanej aktualizacji:', error);
    }
  });
}


// Keepalive dla darmowego planu Render
setInterval(() => {
  console.log('Wykonuję ping serwera...');
  fetch('https://houseapp-backend.onrender.com/')
    .then(() => console.log('Ping successful'))
    .catch(error => console.error('Ping failed:', error));
}, 14 * 60 * 1000); // co 14 minut

// Uruchomienie serwera
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
});

