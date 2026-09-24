import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import {
  createPlan,
  listPlansForUser,
  getPlan,
  updatePlan,
  addPersonByAddress,
  setParticipantTravelModes,
  deletePlan,
  inviteToPlan,
  leavePlan,
  removeParticipant,
  respondToPlan,
  shareLocation,
  computePlanResults,
  getPlanVenueRoutes,
  getPlanPreviewByToken,
  joinPlanByToken,
} from '../services/plans.js';

export const plansRouter = Router();
// requireAuth applied per-route, not via router.use() — see the comment in
// routes/friends.js for why a blanket use() is unsafe on a router mounted at
// the shared '/api' prefix alongside public routers.

plansRouter.post('/plans', requireAuth, (req, res, next) => {
  try {
    const { title, queryText, filters, plannedFor, friendIds } = req.body || {};
    const plan = createPlan({
      hostId: req.user.id,
      title,
      queryText,
      filters,
      plannedFor,
      friendIds,
    });
    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.get('/plans', requireAuth, (req, res) => {
  res.json({ plans: listPlansForUser(req.user.id) });
});

// No requireAuth below — anyone with the link can preview and join, that's
// the whole point. req.user is still populated when a session cookie exists
// (attachUser runs globally), so a signed-in visitor joins as themselves.
plansRouter.get('/plans/join/:token', (req, res, next) => {
  try {
    res.json(getPlanPreviewByToken(req.params.token));
  } catch (err) {
    next(err);
  }
});

plansRouter.post('/plans/join/:token', requireAuth, (req, res, next) => {
  try {
    const { plan } = joinPlanByToken(req.params.token, {
      userId: req.user.id,
      // Someone joining by link says how they get around as they arrive: it's
      // the one moment we have their attention, and their answer is what
      // makes the "fair middle" fair for them.
      travelModes: req.body?.travelModes,
    });
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.get('/plans/:id', requireAuth, (req, res, next) => {
  try {
    res.json({ plan: getPlan(req.params.id, req.user.id) });
  } catch (err) {
    next(err);
  }
});

plansRouter.patch('/plans/:id', requireAuth, (req, res, next) => {
  try {
    const plan = updatePlan(req.params.id, req.user.id, req.body || {});
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.delete('/plans/:id', requireAuth, (req, res, next) => {
  try {
    deletePlan(req.params.id, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

plansRouter.post('/plans/:id/invite', requireAuth, (req, res, next) => {
  try {
    const plan = inviteToPlan(req.params.id, req.user.id, req.body?.friendIds || []);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

// Someone who isn't signing up for anything: the host supplies a name and
// where they're coming from, and they count in the ranking like anyone else.
plansRouter.post('/plans/:id/people', requireAuth, async (req, res, next) => {
  try {
    const { name, address, travelModes } = req.body || {};
    const plan = await addPersonByAddress(req.params.id, req.user.id, { name, address, travelModes });
    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
});

// How one person is getting there *for this plan* — theirs to set, or the
// host's for the people they added by address.
plansRouter.put('/plans/:id/participants/:userId/travel-modes', requireAuth, (req, res, next) => {
  try {
    const plan = setParticipantTravelModes(
      req.params.id,
      req.user.id,
      req.params.userId,
      req.body?.travelModes
    );
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.post('/plans/:id/leave', requireAuth, (req, res, next) => {
  try {
    leavePlan(req.params.id, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

plansRouter.delete('/plans/:id/participants/:userId', requireAuth, (req, res, next) => {
  try {
    const plan = removeParticipant(req.params.id, req.user.id, req.params.userId);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.post('/plans/:id/respond', requireAuth, (req, res, next) => {
  try {
    const plan = respondToPlan(req.params.id, req.user.id, req.body?.action);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.post('/plans/:id/location', requireAuth, async (req, res, next) => {
  try {
    const plan = await shareLocation(req.params.id, req.user.id, req.body || {});
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

plansRouter.get('/plans/:id/results', requireAuth, async (req, res, next) => {
  try {
    res.json(await computePlanResults(req.params.id, req.user.id));
  } catch (err) {
    next(err);
  }
});

plansRouter.get('/plans/:id/routes/:venueId', requireAuth, async (req, res, next) => {
  try {
    res.json(await getPlanVenueRoutes(req.params.id, req.user.id, req.params.venueId));
  } catch (err) {
    next(err);
  }
});
