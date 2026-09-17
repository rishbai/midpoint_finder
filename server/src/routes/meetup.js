import { Router } from 'express';
import { findMeetup } from '../services/meetup.js';
import { normalizeFilters } from '../services/search.js';

export const meetupRouter = Router();

meetupRouter.post('/meetup', async (req, res) => {
  const { addresses, filters, departureTime } = req.body || {};
  const result = await findMeetup({
    addresses,
    filters: normalizeFilters(filters),
    departureTime,
  });
  res.json(result);
});
