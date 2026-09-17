import { Router } from 'express';
import { parseQuery } from '../services/query.js';
import { searchVenues } from '../services/search.js';
import { describeForQuery } from '../services/describe.js';

export const queryRouter = Router();

queryRouter.post('/query', async (req, res, next) => {
  try {
    const text = String(req.body?.q || '').trim();
    if (!text) return res.status(400).json({ error: 'Say what you\'re looking for.' });

    const filters = await parseQuery(text, req.body?.referenceTime);
    const results = searchVenues({ ...filters, lat: req.body?.lat, lng: req.body?.lng, radius: req.body?.radius });
    const descriptions = await describeForQuery(text, results);
    res.json({
      filters,
      results: results.map((v) => ({ ...v, description: descriptions[v.id] || null })),
    });
  } catch (err) {
    next(err);
  }
});
