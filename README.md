# Minblog

A minimal markdown blog engine focused on simplicity and readability.

## Features

- Markdown-based content
- Code syntax highlighting
- RSS feed
- Minimal, terminal-like design
- Fast loading times
- ASCII art title support
- No JavaScript
- No build step

## Configuration

Configuration is done through environment variables in `.env`:

```env
# Blog Settings
BLOG_TITLE=          # Your blog title
BLOG_DESCRIPTION=    # Blog description
BLOG_URL=           # Blog URL (e.g., http://localhost:3000)
BLOG_AUTHOR=        # Your name
ASCII_TITLE_PATH=   # Path to ASCII art title file (optional)

# Social Links (optional)
BLOG_GITHUB=        # GitHub username
BLOG_TWITTER=       # Twitter handle

# Show/Hide Nav Links
SHOW_RSS=true       # Show RSS link in nav
SHOW_GITHUB=true    # Show GitHub link in nav
SHOW_TWITTER=true   # Show Twitter link in nav

# RSS Feed Settings
RSS_TITLE=          # RSS feed title
RSS_DESCRIPTION=    # RSS feed description
RSS_LANGUAGE=en     # RSS feed language

# Theme Settings
THEME_FONT_FAMILY=  # Font stack
THEME_BACKGROUND=   # Background color
THEME_TEXT=         # Text color
THEME_LINK=         # Link color

# Server Settings
PORT=3000           # Server port
PAGINATION_LIMIT=10 # Posts per page
PREVIEW_DRAFTS=     # Show draft posts (true/false)
```

## Content Structure

- `/posts/` - Blog posts (format: YYYY-MM-DD-title.md)
- `/pages/` - Static pages (format: title.md)
- `/static/` - Static files (images, favicon, etc.)

### Post Format

```markdown
---
title: Post Title
date: YYYY-MM-DD
author: Your Name
tags: [tag1, tag2]
draft: false  # Optional, defaults to false
toc: true    # Optional, adds table of contents
---

Post content in markdown...
```

## Running Locally

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure
4. Start the server: `npm start`

## Development

- `npm start` - Start the server
- `npm run dev` - Start with auto-reload

## License

MIT 