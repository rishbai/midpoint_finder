import { Router } from 'express';
import { searchVenues, getVenue, listCuisines, normalizeFilters } from '../services/search.js';
import { CATEGORY_TYPES, VIBES } from '../lib/vocab.js';

export const venuesRouter = Router();

venuesRouter.get('/meta', (req, res) => {
  res.json({
    categories: Object.keys(CATEGORY_TYPES),
    vibes: VIBES,
    cuisines: listCuisines(),
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
