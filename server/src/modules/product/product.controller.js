import * as productService from './product.service.js';

const create = async (req, res, next) => {
  try {
    const product = await productService.create(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

const list = async (req, res, next) => {
  try {
    const result = await productService.findAll(req.query);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const product = await productService.findById(req.params.id);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const product = await productService.update(req.params.id, req.body);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    await productService.remove(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export { create, list, getOne, update, remove };
