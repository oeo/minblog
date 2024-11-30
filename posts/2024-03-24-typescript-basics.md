---
title: "TypeScript Fundamentals"
date: "2024-03-24"
author: "TypeScript Developer"
tags: ["typescript", "javascript", "programming"]
---

# TypeScript Fundamentals

TypeScript adds static typing to JavaScript. Let's explore the basics.

## Why TypeScript?

TypeScript offers:
- Static typing
- Better tooling
- Enhanced IDE support
- Improved maintainability

## Basic Types

```typescript
// Basic types
let name: string = "John";
let age: number = 30;
let isActive: boolean = true;

// Interface
interface User {
  id: number;
  name: string;
  email: string;
}

// Function with types
function greet(user: User): string {
  return `Hello, ${user.name}!`;
}
```

Next: Advanced TypeScript features!