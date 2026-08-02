import { test, expect } from '@playwright/test';

test.describe('登录页 — 品牌标识', () => {
  test('登录页显示品牌 logo 图片而非文本图标', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // 验证 logo 图片存在且可见
    const logo = page.locator('img[alt="AI呼叫中心"]');
    await expect(logo).toBeVisible();

    // 确认使用的是 logo.svg
    await expect(logo).toHaveAttribute('src', '/logo.svg');

    // 确认旧的文本图标不再存在
    const oldIcon = page.locator('.logo-icon');
    await expect(oldIcon).not.toBeVisible();
  });

  test('登录页表单包含用户名密码和登录按钮', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible();
    await expect(page.locator('input[placeholder="密码"]')).toBeVisible();
    await expect(page.locator('button:has-text("登 录")')).toBeVisible();
  });

  test('登录页显示默认账号提示', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=默认账号：admin / 12345678')).toBeVisible();
  });
});
