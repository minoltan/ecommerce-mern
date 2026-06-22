import * as cartService from './cart.service.js';

const getCart = async (req, res, next) => {
  try {
    const cart = await cartService.getCart(req.user.sub);
    res.json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

const addItem = async (req, res, next) => {
  try {
    const cart = await cartService.addItem(req.user.sub, req.body);
    res.json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

const updateQuantity = async (req, res, next) => {
  try {
    const cart = await cartService.updateQuantity(req.user.sub, req.params.productId, req.body.quantity);
    res.json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

const removeItem = async (req, res, next) => {
  try {
    const cart = await cartService.removeItem(req.user.sub, req.params.productId);
    res.json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

const checkout = async (req, res, next) => {
  try {
    const result = await cartService.checkout(req.user.sub, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export { getCart, addItem, updateQuantity, removeItem, checkout };
