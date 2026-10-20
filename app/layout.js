import './globals.css';

export const metadata = {
  title: 'Influencer Studio',
  description: 'Personal AI image and video studio powered by the Gemini API.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
