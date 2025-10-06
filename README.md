# Quantara Waitlist

Static landing page + form for the Quantara Devnet-0 waitlist.

## Deploy
- **Cloudflare Pages**: Project → Framework = None, Build command = (empty), Output dir = `public`
- **Vercel**: Import → Root Directory = `public`, Framework = Other
- **Netlify**: Drag & drop `public/` or connect repo

## Form handling
This page includes a Netlify-ready form (`data-netlify="true"`).  
If you use a different provider (Tally/Typeform/Formspree), replace the `<form>` `action` and remove the Netlify attributes.

## Branding
Place your logo at `public/assets/logo.svg`, update `og-image.png`, and favicon as needed.
# quantara-waitlist
