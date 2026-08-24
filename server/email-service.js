import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;
const FROM_NAME = process.env.MAIL_FROM_NAME || 'TokenPlan 价格预警';
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || SMTP_USER;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    console.log('[邮件] 使用 SMTP:', SMTP_HOST);
    return transporter;
  }

  if (RESEND_API_KEY) {
    transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: RESEND_API_KEY },
    });
    console.log('[邮件] 使用 Resend API');
    return transporter;
  }

  // 开发模式：使用 Ethereal 测试邮箱
  console.warn('[邮件] 未配置 SMTP 或 Resend，使用 Ethereal 测试邮箱（仅开发）');
  return null;
}

async function getDevTransporter() {
  const testAccount = await nodemailer.createTestAccount();
  return {
    transport: nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    }),
    testAccount,
  };
}

function getFromAddress(devAccount) {
  if (RESEND_API_KEY && RESEND_FROM) return RESEND_FROM;
  if (FROM_ADDRESS) return FROM_ADDRESS;
  if (devAccount) return devAccount.user;
  return 'noreply@tokenplan.local';
}

export async function sendAlertEmail(toEmail, subject, htmlBody, textBody) {
  let transport = getTransporter();
  let devInfo = null;
  let devAccount = null;

  if (!transport) {
    const dev = await getDevTransporter();
    transport = dev.transport;
    devAccount = dev.testAccount;
    devInfo = true;
  }

  const from = `"${FROM_NAME}" <${getFromAddress(devAccount)}>`;

  const info = await transport.sendMail({
    from,
    to: toEmail,
    subject,
    text: textBody || htmlBody.replace(/<[^>]*>/g, ''),
    html: htmlBody,
  });

  if (devInfo) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[邮件] 测试邮件已发送: ${info.messageId}`);
    console.log(`[邮件] 预览链接: ${previewUrl}`);
    return { success: true, previewUrl, dev: true };
  }

  console.log(`[邮件] 已发送至 ${toEmail}: ${info.messageId}`);
  return { success: true, messageId: info.messageId };
}

export async function sendWelcomeEmail(email, providers, alertTypes, unsubToken) {
  const providerList = providers.length > 0 ? providers.join('、') : '全部厂商';
  const typeList = alertTypes.length > 0 ? alertTypes.join('、') : '全部类型';
  const unsubUrl = `http://localhost:${process.env.PORT || 3210}/api/unsubscribe?token=${unsubToken}`;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#e4e4e7;border-radius:16px;overflow:hidden;border:1px solid #2a2a3a">
      <div style="background:linear-gradient(135deg,#e8b54a 0%,#5ce1ff 100%);padding:32px 40px;text-align:center">
        <h1 style="margin:0;font-size:24px;color:#0a0e1a;font-weight:800;letter-spacing:-0.02em">TokenPlan 价格预警</h1>
        <p style="margin:8px 0 0;color:#0a0e1a;opacity:0.8;font-size:14px">订阅成功确认</p>
      </div>
      <div style="padding:32px 40px">
        <p style="font-size:16px;line-height:1.6;color:#e4e4e7">您好，价格预警订阅已成功开启！</p>
        <div style="background:#12131f;border:1px solid #2a2a3a;border-radius:12px;padding:20px;margin:24px 0">
          <p style="margin:0 0 8px;color:#8b8b9a;font-size:12px;text-transform:uppercase;letter-spacing:0.1em">订阅详情</p>
          <p style="margin:4px 0;color:#e4e4e7;font-size:14px"><strong>关注厂商：</strong>${providerList}</p>
          <p style="margin:4px 0;color:#e4e4e7;font-size:14px"><strong>预警类型：</strong>${typeList}</p>
        </div>
        <p style="font-size:14px;color:#8b8b9a;line-height:1.6">当您关注的厂商发生价格变动时，我们会第一时间发送邮件通知您。您可以随时通过下方链接退订。</p>
        <a href="${unsubUrl}" style="display:inline-block;margin-top:16px;padding:10px 24px;background:transparent;border:1px solid #2a2a3a;color:#8b8b9a;text-decoration:none;border-radius:8px;font-size:13px">退订预警</a>
      </div>
      <div style="padding:20px 40px;border-top:1px solid #2a2a3a;text-align:center">
        <p style="margin:0;color:#5a5a6a;font-size:12px">TokenPlan · 全球 AI Token 定价全景指南</p>
      </div>
    </div>
  `;

  return sendAlertEmail(email, 'TokenPlan 价格预警 - 订阅成功确认', html);
}

export async function sendPriceChangeEmail(email, change, unsubToken) {
  const unsubUrl = `http://localhost:${process.env.PORT || 3210}/api/unsubscribe?token=${unsubToken}`;
  const isDrop = change.type === 'drop';
  const icon = isDrop ? '📉' : change.type === 'new' ? '🆕' : '📈';
  const color = isDrop ? '#34d399' : change.type === 'new' ? '#5ce1ff' : '#fb923c';

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#e4e4e7;border-radius:16px;overflow:hidden;border:1px solid #2a2a3a">
      <div style="background:linear-gradient(135deg,${color} 0%,#1a1a2a 100%);padding:32px 40px">
        <p style="margin:0;font-size:12px;color:#0a0e1a;text-transform:uppercase;letter-spacing:0.15em;opacity:0.7">${change.tag}</p>
        <h1 style="margin:8px 0 0;font-size:22px;color:#0a0e1a;font-weight:800">${icon} ${change.provider} ${change.model}</h1>
      </div>
      <div style="padding:32px 40px">
        <div style="background:#12131f;border:1px solid #2a2a3a;border-radius:12px;padding:20px;margin:0 0 24px">
          <p style="margin:0 0 4px;color:#8b8b9a;font-size:12px">价格变动</p>
          <p style="margin:4px 0;color:#e4e4e7;font-size:16px;line-height:1.5">${change.change.replace(/<[^>]*>/g, '')}</p>
        </div>
        <p style="font-size:14px;color:#8b8b9a;line-height:1.6;margin:0 0 8px">${change.note}</p>
        <p style="font-size:12px;color:#5a5a6a">变动日期：${change.date}</p>
        <a href="${unsubUrl}" style="display:inline-block;margin-top:20px;padding:8px 20px;background:transparent;border:1px solid #2a2a3a;color:#8b8b9a;text-decoration:none;border-radius:8px;font-size:12px">退订预警</a>
      </div>
      <div style="padding:20px 40px;border-top:1px solid #2a2a3a;text-align:center">
        <p style="margin:0;color:#5a5a6a;font-size:12px">TokenPlan · 价格变动实时通知</p>
      </div>
    </div>
  `;

  return sendAlertEmail(email, `${icon} ${change.provider} ${change.model} - ${change.tag}`, html);
}

export function isEmailConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS) || !!RESEND_API_KEY;
}
