import { Router } from 'express';
import { searchVenues, getVenue, listCuisines, normalizeFilters } from '../services/search.js';
import { CATEGORY_TYPES, VIBES, STYLES_BY_CATEGORY } from '../lib/vocab.js';

export const venuesRouter = Router();

venuesRouter.get('/meta', (req, res) => {
  res.json({
    categories: Object.keys(CATEGORY_TYPES),
    vibes: VIBES,
    cuisines: listCuisines(),
    // Per category, the kinds of place within it (see lib/vocab.js).
    styles: Object.fromEntries(
      Object.entries(STYLES_BY_CATEGORY).map(([cat, styles]) => [cat, Object.keys(styles)])
    ),
  });
});

venuesRouter.get('/venues', (req, res) => {
  res.json({ results: searchVenues(normalizeFilters(req.query)) });
});

venuesRouter.get('/venues/:id', (req, res) => {
  const venue = getVenue(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  res.json(venue);
});
