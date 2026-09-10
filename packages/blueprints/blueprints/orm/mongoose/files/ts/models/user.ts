import { model, Schema } from 'mongoose';

export interface User {
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A starter model. Delete it once you have a real one. */
const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  },
  { timestamps: true },
);

export const UserModel = model<User>('User', userSchema);
