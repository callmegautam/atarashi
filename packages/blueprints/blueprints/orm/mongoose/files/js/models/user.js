import { model, Schema } from 'mongoose';

/** A starter model. Delete it once you have a real one. */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  },
  { timestamps: true },
);

export const UserModel = model('User', userSchema);
