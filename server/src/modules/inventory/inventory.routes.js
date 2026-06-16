const { Router } = require('express');
const { getByProduct, upsert } = require('./inventory.controller');
const { authenticate, authorize } = require('../../shared/middleware/auth.middleware');

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Inventory
 *   description: Stock level management
 */

/**
 * @swagger
 * /inventory/{productId}:
 *   get:
 *     summary: Get inventory for a product
 *     tags: [Inventory]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory record
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Inventory'
 *       404:
 *         description: Inventory not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:productId', getByProduct);

/**
 * @swagger
 * /inventory/{productId}:
 *   put:
 *     summary: Set stock quantity for a product (admin only)
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 0
 *                 example: 100
 *               lowStockThreshold:
 *                 type: integer
 *                 example: 10
 *     responses:
 *       200:
 *         description: Inventory updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Inventory'
 */
router.put('/:productId', authenticate, authorize('admin'), upsert);

module.exports = router;
