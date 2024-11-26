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
    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `http://api.scraperapi.com?api_key=${scrapingApiKey}&url=${encodedUrl}&render=true`;

    console.log('Wysyłam request do ScraperAPI');
    const response = await axios.get(apiUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    // Debug: Zbieranie wszystkich parametrów
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

    // Cena - szukamy w różnych miejscach
    let priceText = '';
    [
      '[data-cy="adPageHeaderPrice"]',
      '[aria-label="Cena"]',
      '.css-8qi9av',
      'div[data-testid="price"]'
    ].forEach(selector => {
      if (!priceText) {
        priceText = $(selector).first().text().trim();
      }
    });
    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;
    console.log('Znaleziona cena:', price, 'z tekstu:', priceText);

    // Powierzchnia
    let area = null;
    const areaRegex = /(\d+(?:[,.]\d+)?)\s*m²/;
    Object.entries(allParameters).forEach(([key, value]) => {
      if (key.toLowerCase().includes('powierzchnia') && !key.toLowerCase().includes('działki')) {
        const match = value.match(areaRegex);
        if (match) {
          area = parseFloat(match[1].replace(',', '.'));
        }
      }
    });
    console.log('Znaleziona powierzchnia:', area);

    // Powierzchnia działki
    let plotArea = null;
    Object.entries(allParameters).forEach(([key, value]) => {
      if (key.toLowerCase().includes('powierzchnia działki') || key.toLowerCase().includes('działka')) {
        const match = value.match(areaRegex);
        if (match) {
          plotArea = parseFloat(match[1].replace(',', '.'));
        }
      }
    });
    console.log('Znaleziona powierzchnia działki:', plotArea);

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
    console.log('Znalezione pokoje:', rooms);

    // Lokalizacja
    let location = '';
    const locationSelectors = [
      '[data-testid="location-name"]',
      '.css-17o5lod',
      '[data-testid="ad-header-location"]',
      '[aria-label="Adres"]',
      '[data-testid="location"]'
    ];

    // Najpierw próbujemy znaleźć lokalizację bezpośrednio
    for (const selector of locationSelectors) {
      if (!location) {
        location = $(selector).first().text().trim();
      }
    }

    // Jeśli nie znaleziono, próbujemy z breadcrumbów
    if (!location) {
      const breadcrumbs = $('[data-cy="breadcrumbs-link"]')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => !text.includes('Ogłoszenia') && !text.includes('Nieruchomości'));
      
      if (breadcrumbs.length > 0) {
        location = breadcrumbs.join(', ');
      }
    }

    // Jeśli nadal nie znaleziono, szukamy w szczegółach
    if (!location) {
      Object.entries(allParameters).forEach(([key, value]) => {
        if (key.toLowerCase().includes('lokalizacja') || key.toLowerCase().includes('adres')) {
          location = value;
        }
      });
    }

    console.log('Znaleziona lokalizacja:', location);

    // Opis
    const description = $('[data-cy="adPageDescription"]').first().text().trim() ||
                       $('div[data-testid="ad-description"]').first().text().trim();
    console.log('Opis (fragment):', description?.substring(0, 100));

    const result = {
      title: title || '',
      price,
      area,
      plotArea,
      rooms,
      location,
      description: description || '',
      sourceUrl: url,
      source: 'otodom',
      parameters: allParameters // zachowujemy wszystkie parametry do debugowania
    };

    console.log('Końcowe dane:', result);
    return result;

  } catch (error) {
    console.error('Szczegóły błędu:', {
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

// Rejestracja
app.post('/api/auth/register', async (req, res) => {
  console.log('Otrzymano request rejestracji:', {
    email: req.body.email,
    hasPassword: !!req.body.password,
    hasName: !!req.body.name
  });

  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      console.log('Brak wymaganych pól');
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

// Scraping
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

    // Zapisz historię cen jeśli cena się zmieniła
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
          
          // Zapisz starą cenę w historii
          if (!property.priceHistory) property.priceHistory = [];
          property.priceHistory.push({
            price: property.price,
            date: new Date()
          });

          // Aktualizuj dane
          property.price = scrapedData.price;
          property.lastChecked = new Date();
          property.isActive = true;
          
          // Aktualizuj inne pola, jeśli się zmieniły
          if (scrapedData.area) property.area = scrapedData.area;
          if (scrapedData.plotArea) property.plotArea = scrapedData.plotArea;
          if (scrapedData.rooms) property.rooms = scrapedData.rooms;
          if (scrapedData.location) property.location = scrapedData.location;
          
          await property.save();
          
          updates.push({
            id: property._id,
            title: property.title,
            oldPrice: property.price,
            newPrice: scrapedData.price,
            updatedAt: new Date()
          });
        } else {
          // Nawet jeśli cena się nie zmieniła, aktualizujemy datę sprawdzenia
          property.lastChecked = new Date();
          await property.save();
        }
      } catch (error) {
        console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
        // Jeśli nie udało się pobrać danych, oznacz ogłoszenie jako nieaktywne
        property.isActive = false;
        property.lastChecked = new Date();
        await property.save();
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
      // Dodaj pierwotną cenę
      {
        price: property.price,
        date: property.createdAt
      },
      // Dodaj historię zmian
      ...(property.priceHistory || [])
    ].sort((a, b) => new Date(b.date) - new Date(a.date)); // Sortuj od najnowszych

    res.json(priceHistory);
  } catch (error) {
    console.error('Błąd podczas pobierania historii cen:', error);
    res.status(500).json({ error: error.message });
  }
});

// Zadanie cron do automatycznej aktualizacji cen
if (cron) {
  // Uruchamiaj o 00:05 każdego dnia
  cron.schedule('5 0 * * *', async () => {
    console.log('Rozpoczynam zaplanowaną aktualizację cen...');
    try {
      const properties = await Property.find({
        sourceUrl: { $exists: true, $ne: '' }
      });

      console.log(`Znaleziono ${properties.length} ogłoszeń do sprawdzenia`);

      for (const property of properties) {
        try {
          console.log(`Sprawdzam: ${property.title}`);
          const scrapedData = await scrapeOtodom(property.sourceUrl);
          
          if (scrapedData.price && scrapedData.price !== property.price) {
            console.log(`Aktualizacja ceny dla ${property.title}: ${property.price} -> ${scrapedData.price}`);
            
            if (!property.priceHistory) property.priceHistory = [];
            property.priceHistory.push({
              price: property.price,
              date: new Date()
            });

            property.price = scrapedData.price;
            property.isActive = true;
            // Aktualizuj inne pola
            if (scrapedData.area) property.area = scrapedData.area;
            if (scrapedData.plotArea) property.plotArea = scrapedData.plotArea;
            if (scrapedData.rooms) property.rooms = scrapedData.rooms;
            if (scrapedData.location) property.location = scrapedData.location;
          }
          
          property.lastChecked = new Date();
          await property.save();
        } catch (error) {
          console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
          property.isActive = false;
          property.lastChecked = new Date();
          await property.save();
        }
      }

      console.log('Zakończono zaplanowaną aktualizację cen');
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

