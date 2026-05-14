import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SipProvider } from './contexts/SipContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SipProvider>
        <App />
      </SipProvider>
    </BrowserRouter>
  </React.StrictMode>
);
