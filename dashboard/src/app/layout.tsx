import React from 'react';
import './globals.css'; // Assuming you have a globals.css for Tailwind

export const metadata = {
  title: 'Aegis Nurse Dashboard',
  description: 'Real-time clinical triage dashboard for nurses.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 font-sans">{children}</body>
    </html>
  );
}
