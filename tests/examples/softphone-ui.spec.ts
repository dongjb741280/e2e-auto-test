import { test, expect } from '@playwright/test';

const TEST_USERNAME = process.env.TEST_USERNAME || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password';

test.describe('软电话工作台 — UI 布局', () => {
  test.beforeEach(async ({ page }) => {
    // 登录系统
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[placeholder="用户名"]', TEST_USERNAME);
    await page.fill('input[placeholder="密码"]', TEST_PASSWORD);
    await page.click('button:has-text("登 录")');
    // 登录成功后可能跳转到 / 或 /softphone
    await page.waitForTimeout(2000);
    // 显式导航到软电话页面
    await page.goto('/softphone');
    await page.waitForLoadState('networkidle');
  });

  test('软电话页面包含三个功能卡片：连接、通话控制、班长监控', async ({ page }) => {
    // 验证卡片标题
    await expect(page.locator('.card-header span:has-text("连接")')).toBeVisible();
    await expect(page.locator('.card-header span:has-text("通话控制")')).toBeVisible();
    await expect(page.locator('.card-header span:has-text("班长监控")')).toBeVisible();
  });

  test('连接卡片包含账号、密码、接听方式、模式，不包含FS地址', async ({ page }) => {
    // 验证输入字段
    await expect(page.locator('input[placeholder="agent1002"]')).toBeVisible(); // 账号
    await expect(page.locator('input[placeholder="密码"]')).toBeVisible(); // 密码

    // 接听和模式选择器
    await expect(page.locator('.el-select').filter({ hasText: 'WebRTC' })).toBeVisible();
    await expect(page.locator('.el-select').filter({ hasText: '普通' })).toBeVisible();

    // 确认没有 FS 地址字段
    await expect(page.locator('input[placeholder*="FreeSWITCH"]')).not.toBeVisible();

    // 验证连接/登出/忙碌/空闲按钮
    await expect(page.locator('button:has-text("连接")')).toBeVisible();
    await expect(page.locator('button:has-text("登出")')).toBeVisible();
    await expect(page.locator('button:has-text("忙碌")')).toBeVisible();
    await expect(page.locator('button:has-text("空闲")')).toBeVisible();
  });

  test('通话控制卡片包含外呼/应答/挂机按钮', async ({ page }) => {
    await expect(page.locator('input[placeholder="被叫号码"]')).toBeVisible();
    await expect(page.locator('button:has-text("外呼")')).toBeVisible();
    await expect(page.locator('button:has-text("应答")')).toBeVisible();
    await expect(page.locator('button:has-text("挂机")')).toBeVisible();
  });

  test('通话控制卡片包含转接功能', async ({ page }) => {
    await expect(page.locator('input[placeholder="转接目标"]')).toBeVisible();
    await expect(page.locator('button:has-text("转接")')).toBeVisible();
  });

  test('通话控制卡片包含咨询+取消咨询按钮', async ({ page }) => {
    await expect(page.locator('input[placeholder="咨询目标"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '咨询', exact: true })).toBeVisible();
    // 咨询取消按钮 (X 图标, 无文本标签)
    const cancelConsultBtn = page.locator('.call-row').filter({ has: page.locator('input[placeholder="咨询目标"]') }).locator('button.el-button--danger.is-plain');
    await expect(cancelConsultBtn).toBeVisible();
  });

  test('通话控制卡片包含咨询转接+三方按钮', async ({ page }) => {
    await expect(page.locator('input[placeholder="咨询转接目标"]')).toBeVisible();
    await expect(page.locator('button:has-text("咨询转")')).toBeVisible();
    // 咨询三方按钮 (Connection 图标)
    const partyBtn = page.locator('.call-row').filter({ has: page.locator('input[placeholder="咨询转接目标"]') }).locator('button.el-button--success');
    await expect(partyBtn).toBeVisible();
  });

  test('通话控制卡片包含静音/取消静音/保持/取消保持', async ({ page }) => {
    await expect(page.getByRole('button', { name: '静音', exact: true })).toBeVisible();
    await expect(page.locator('button:has-text("取消静音")')).toBeVisible();
    await expect(page.getByRole('button', { name: '保持', exact: true })).toBeVisible();
    await expect(page.locator('button:has-text("取消保持")')).toBeVisible();
  });

  test('未连接状态下所有操作按钮均为禁用', async ({ page }) => {
    // 登出按钮 (未连接状态)
    const logoutBtn = page.locator('button:has-text("登出")');
    await expect(logoutBtn).toBeDisabled();

    // 忙碌/空闲
    await expect(page.locator('button:has-text("忙碌")')).toBeDisabled();
    await expect(page.locator('button:has-text("空闲")')).toBeDisabled();

    // 外呼/应答/挂机
    await expect(page.locator('button:has-text("外呼")')).toBeDisabled();
    await expect(page.locator('button:has-text("应答")')).toBeDisabled();
    await expect(page.locator('button:has-text("挂机")')).toBeDisabled();

    // 转接
    await expect(page.locator('button:has-text("转接")')).toBeDisabled();

    // 咨询
    await expect(page.getByRole('button', { name: '咨询', exact: true })).toBeDisabled();

    // 静音/保持
    await expect(page.getByRole('button', { name: '静音', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '保持', exact: true })).toBeDisabled();
  });

  test('消息日志显示 CallSdk 已就绪', async ({ page }) => {
    // 验证 SDK 重构为 ES 模块后正常加载
    await expect(page.locator('text=CallSdk 已就绪（本地模块）')).toBeVisible();
  });

  test('消息日志不显示旧的 Voice9 SDK 消息', async ({ page }) => {
    // 确认没有旧的动态加载方式
    await expect(page.locator('text=Voice9 SDK 已就绪')).not.toBeVisible();
  });
});
