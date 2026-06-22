import mongoose from 'mongoose';
import env from './env.js';

const connect = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`MongoDB connected: ${env.MONGODB_URI}`);
};

const disconnect = async () => {
  await mongoose.disconnect();
};

export { connect, disconnect };
