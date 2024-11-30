---
title: "Getting Started with Machine Learning"
date: "2024-03-22"
author: "ML Engineer"
tags: ["machine learning", "AI", "python"]
---

# Getting Started with Machine Learning

Begin your journey into machine learning with this introductory guide.

## What is Machine Learning?

Machine learning is a subset of AI that enables systems to learn from data without explicit programming.

## Simple Classification Example

```python
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression

# Prepare data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# Train model
model = LogisticRegression()
model.fit(X_train, y_train)
```

Next up: Deep Learning basics!