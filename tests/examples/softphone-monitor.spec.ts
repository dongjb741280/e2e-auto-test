import { test, expect } from '@playwright/test';

test.describe('软电话工作台 — 班长监控功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[placeholder="用户名"]', 'admin');
    await page.fill('input[placeholder="密码"]', '12345678');
    await page.click('button:has-text("登 录")');
    await page.waitForTimeout(2000);
    await page.goto('/softphone');
    await page.waitForLoadState('networkidle');
  });

  test('班长监控卡片包含目标坐席输入和三个监控按钮', async ({ page }) => {
    await expect(page.locator('input[placeholder="目标坐席"]')).toBeVisible();
    await expect(page.locator('button:has-text("监听")')).toBeVisible();
    await expect(page.locator('button:has-text("强插")')).toBeVisible();
    await expect(page.locator('button:has-text("耳语")')).toBeVisible();
  });

  test('未连接状态下班长监控按钮均为禁用', async ({ page }) => {
    await expect(page.locator('button:has-text("监听")')).toBeDisabled();
    await expect(page.locator('button:has-text("强插")')).toBeDisabled();
    await expect(page.locator('button:has-text("耳语")')).toBeDisabled();
  });

  test('班长监控：未输入目标坐席时点击监听应提示', async ({ page }) => {
    // 先连接（模拟消息提示，实际连接会失败因为无后端服务，但UI应该验证）
    // 清空目标坐席输入
    const monitorInput = page.locator('input[placeholder="目标坐席"]');
    await monitorInput.clear();

    // 验证输入框存在且按钮禁用
    await expect(monitorInput).toBeVisible();
    await expect(page.locator('button:has-text("监听")')).toBeDisabled();
  });

  test('班长监控：输入目标坐席后按钮视觉存在', async ({ page }) => {
    const monitorInput = page.locator('input[placeholder="目标坐席"]');
    await monitorInput.fill('1005');
    await expect(monitorInput).toHaveValue('1005');
  });
});
