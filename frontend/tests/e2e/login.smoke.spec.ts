import { expect, test } from '@playwright/test'

const signedOutResponse = JSON.stringify({
  code: 'session_expired',
  message: 'No active session.',
  field_errors: {},
  request_id: 'e2e-session-check',
})

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: signedOutResponse,
    })
  })
  await page.goto('/login')
})

test('renders the secure login screen', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
  await expect(page.getByPlaceholder('Enter your username')).toBeVisible()
  await expect(page.getByPlaceholder('Enter your password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('toggles password visibility without submitting', async ({ page }) => {
  const password = page.getByPlaceholder('Enter your password')
  await password.fill('ExamplePassword123!')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible()
})
