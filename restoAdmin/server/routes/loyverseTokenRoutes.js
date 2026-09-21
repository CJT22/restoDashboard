// ============================================
// LOYVERSE TOKEN ROUTES
// ============================================
// File: routes/loyverseTokenRoutes.js
// Description: 3coredev-only CRUD for per-branch Loyverse access tokens.
// Kept separate from loyverseRoutes.js (sync endpoints) so every
// require3core-gated route in the app stays easy to grep in one place.
// ============================================

const express = require('express');
const router = express.Router();
const { authenticate, require3core } = require('../middleware/unifiedAuth');
const LoyverseTokenController = require('../controllers/loyverseTokenController');

router.get('/api/loyverse/tokens', authenticate, require3core, LoyverseTokenController.list);
router.post('/api/loyverse/tokens', authenticate, require3core, LoyverseTokenController.create);
router.put('/api/loyverse/tokens/:id', authenticate, require3core, LoyverseTokenController.update);

module.exports = router;
