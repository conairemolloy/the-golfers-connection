# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m4-journey.spec.ts >> request → offer → accept → confirm settles the ledger
- Location: tests/e2e/m4-journey.spec.ts:47:5

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - link "The Golfers’ Connection" [ref=e4] [cursor=pointer]:
        - /url: /
        - generic [ref=e5]: The Golfers’
        - generic [ref=e6]: Connection
    - main [ref=e8]:
      - generic [ref=e9]:
        - heading "Sign in" [level=1] [ref=e10]
        - generic [ref=e11]:
          - alert [ref=e12]: That link didn't work. Request a new one below.
          - generic [ref=e13]:
            - generic [ref=e14]: Email
            - textbox "Email" [ref=e15]
          - button "Send magic link" [ref=e16]
  - button "Open Next.js Dev Tools" [ref=e22] [cursor=pointer]
  - alert [ref=e26]
```