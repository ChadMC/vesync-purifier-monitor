# VeSync Air Purifier Monitor

A web-based interface for managing VeSync devices using Python backend and React frontend.

## Prerequisites

- Python 3.8 or higher
- Node.js 16 or higher
- A VeSync account with registered devices

## Installation

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and configure environment variables:
   ```bash
   cp example.env .env
   ```
   Edit `.env` and add your VeSync credentials and desired Flask secret key.

3. Create a virtual environment:
   ```bash
   python -m venv venv
   ```

4. Activate the virtual environment:
   - Windows:
     ```bash
     .\venv\Scripts\activate
     ```
   - Linux/Mac:
     ```bash
     source venv/bin/activate
     ```

5. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

6. Start the backend server:
   ```bash
   python app.py
   ```
   The backend will run on http://localhost:5000

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```
   The frontend will run on http://localhost:4000

## Usage

Once both servers are running, open your web browser and navigate to http://localhost:4000 to access the web interface.

## Development

The backend uses Flask-SocketIO for real-time device updates, and the frontend uses React with Socket.IO client for live updates of device states.
