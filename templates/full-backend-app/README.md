# Atarashi Backend Template

This is a pre-built backend template for rapid development using **Node.js, Express, and MongoDB**. It follows best practices, including an MVC architecture, JWT authentication, error handling, and environment-based configurations.

## Features

-   **Express.js** for backend framework
-   **MongoDB with Mongoose** for database handling
-   **JWT Authentication** for secure user authentication
-   **Dotenv** for managing environment variables
-   **Centralized Error Handling** for better debugging
-   **Pre-configured CRUD APIs** for quick development
-   **CORS & Helmet** for security enhancements

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/atarashi-backend-template.git
cd atarashi-backend-template
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the root directory and add:

```
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
```

### 4. Run the Application

#### Development Mode

```bash
npm run dev
```

#### Production Mode

```bash
npm start
```

## Folder Structure

```
atarashi-backend-template/
├── src/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middlewares/
│   ├── db/
│   ├── utils/
│   ├── index.js
├── .env
├── .gitignore
├── package.json
├── README.md
```

## API Endpoints

### Auth Routes

-   `POST /api/auth/register` - Register a new user
-   `POST /api/auth/login` - Authenticate and get a token

### User Routes (Protected)

-   `GET /api/users/me` - Get logged-in user details

### CRUD Example (Modify as needed)

-   `GET /api/items` - Fetch all items
-   `POST /api/items` - Create a new item
-   `PUT /api/items/:id` - Update an item
-   `DELETE /api/items/:id` - Remove an item

## Contributing

Feel free to contribute by submitting a pull request!

## License

MIT
