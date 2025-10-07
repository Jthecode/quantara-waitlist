/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        qbg:"#0a0b0d", qpanel:"#101217", qline:"#191e25",
        qgold:"#f1c46b", qmuted:"#9aa0a6", qgreen:"#8BE7A1"
      },
      boxShadow: { glow:"0 0 0 1px rgba(241,196,107,.18), 0 18px 60px rgba(241,196,107,.10)" }
    }
  }
};
