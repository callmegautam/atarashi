export const cookieOptions = {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: 'strict',
    domain: 'localhost',
    path: '/',
};
