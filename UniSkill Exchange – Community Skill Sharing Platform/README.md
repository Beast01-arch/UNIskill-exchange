# UniSkill Exchange – Community Skill Sharing Platform

## Overview

UniSkill Exchange is a full-stack web application designed to connect individuals, students, and organisations through a collaborative skill-sharing ecosystem. The platform enables users to share knowledge, discover learning opportunities, exchange skills, and build professional connections within a supportive community environment.

The application was developed using modern web technologies including Node.js, Express.js, MySQL, and Pug. It demonstrates secure authentication systems, database integration, RESTful routing, dynamic page rendering, and scalable software engineering principles.

---

# Features

## User Authentication & Security
- Secure user registration and login system
- Password encryption using bcryptjs
- Session-based authentication
- Protected routes and middleware
- Flash message notifications
- Environment variable protection using dotenv

---

## User Profile Management
- Create and update personal profiles
- Display user skills and interests
- Personalised dashboard
- Account management system

---

## Skill Exchange System
- Add and manage skills
- Browse available skills
- Exchange learning opportunities
- Peer-to-peer collaboration
- Community learning support

---

## Organisation Management
- Organisation registration functionality
- Manage organisation profiles
- Offer learning opportunities
- Connect organisations with users

---

## Database Integration
- MySQL relational database support
- Structured schema design
- Persistent data storage
- Efficient database operations

---

## Frontend Functionality
- Dynamic page rendering using Pug
- Responsive user interface
- Interactive navigation system
- Form validation and handling

---

## Backend Functionality
- RESTful routing architecture
- Express.js middleware integration
- Modular backend structure
- Server-side data processing
- MVC-inspired project organisation

---

# Technologies Used

| Technology | Purpose |
|------------|---------|
| Node.js | Backend runtime environment |
| Express.js | Web application framework |
| MySQL | Relational database management |
| Pug | Template engine |
| bcryptjs | Password hashing |
| express-session | Session management |
| connect-flash | Flash messaging |
| dotenv | Environment variable management |
| method-override | HTTP method support |
| JavaScript | Application logic |
| CSS | Frontend styling |

---

# System Architecture

```text
Client Side (Frontend)
        ↓
Express.js Server
        ↓
Routes & Middleware
        ↓
Business Logic / Services
        ↓
MySQL Database
```

---

# Project Structure

```bash
UniSkill-Exchange/
│
├── app/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── controllers/
│
├── db/
│
├── public/
│   ├── css/
│   ├── js/
│   └── images/
│
├── views/
│   ├── partials/
│   ├── layouts/
│   └── pages/
│
├── node_modules/
│
├── .env
├── package.json
├── index.js
├── sd2-db.sql
└── README.md
```

---

# Installation Guide

## 1. Clone the Repository

```bash
git clone <repository-url>
cd UniSkill-Exchange
```

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Configure Environment Variables

Create a `.env` file in the root directory and add the following:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=sd2-db
SESSION_SECRET=your_secret_key
```

---

## 4. Setup MySQL Database

Import the provided SQL database file:

```bash
mysql -u root -p sd2-db < sd2-db.sql
```

---

## 5. Run the Application

```bash
npm start
```

or

```bash
node index.js
```

---

## 6. Open in Browser

```text
http://localhost:3000
```

---

# Database Design

The system uses a relational MySQL database to manage:

- User accounts
- Authentication data
- Skills and categories
- Skill exchange records
- Organisations
- User profiles
- Session data

The database ensures:
- Data consistency
- Relationship integrity
- Scalable structure
- Efficient query performance

---

# Authentication & Security

Security features implemented in the application include:

- Password hashing with bcryptjs
- Session authentication
- Secure environment variable storage
- Middleware-protected routes
- Input validation
- Flash error handling

---

# CI/CD Integration

The project includes a GitHub Actions CI pipeline that automatically:

- Installs dependencies
- Creates a MySQL test environment
- Imports the database schema
- Runs smoke tests
- Verifies successful application startup

This ensures continuous integration and deployment reliability.

---

# Learning Outcomes

This project demonstrates practical implementation of:

- Full-stack web development
- Backend development with Node.js and Express.js
- MySQL database integration
- RESTful API routing
- MVC-inspired architecture
- Authentication and security
- Session management
- Dynamic rendering using Pug
- CI/CD workflows using GitHub Actions
- Software engineering best practices

---

# Future Improvements

Potential future enhancements include:

- Real-time chat system
- Skill rating and review system
- AI-based recommendations
- Search and advanced filtering
- Email verification system
- Notification functionality
- Mobile responsiveness improvements
- Admin analytics dashboard
- API integration
- Docker containerisation
- Automated unit and integration testing

---

# Testing

The application supports automated smoke testing through GitHub Actions.

Example tested routes:
- `/`
- `/skills`

Future testing improvements may include:
- Unit testing
- Integration testing
- End-to-end testing
- Security testing

---

# Deployment

The application can be deployed using:

- Render
- Railway
- Heroku
- AWS
- DigitalOcean
- Docker

---

# Author

**Saroj Sapkota**  
Software Engineering / Full-Stack Development Project

---

# License

This project is licensed under the ISC License.

---

# Conclusion

UniSkill Exchange is a professional full-stack web application that demonstrates modern software engineering principles and collaborative learning concepts. The platform combines secure authentication, relational database management, dynamic user interaction, and scalable architecture to create a functional community-driven skill-sharing system.

The project reflects practical implementation of backend development, database management, frontend rendering, and CI/CD integration while promoting peer-to-peer learning and digital collaboration.
