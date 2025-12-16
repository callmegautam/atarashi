import bcrypt from 'bcryptjs';

export const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, 12);
};

export const verifyPassword = async (
  password: string,
  hashPassword: string,
): Promise<boolean> => {
  return await bcrypt.compare(password, hashPassword);
};

export const removePassword = <T extends { passwordHash?: string }>(data: T) => {
  const { passwordHash, ...rest } = data;
  return rest;
};
