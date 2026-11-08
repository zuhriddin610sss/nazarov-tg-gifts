export type Lang = "uz" | "ru" | "en" | "zh";

const T = {
  uz: {
    welcome: "Assalomu alaykum! NAZAROVtggifts — Telegram sovg'alari.\nXizmatni tanlash uchun quyidagi tugmani bosing.",
    open: "🎁 Xizmatlarni ochish",
    share_phone: "Buyurtma berish uchun telefon raqamingizni ulashing.",
    share_btn: "📱 Raqamni ulashish",
    phone_saved: "Rahmat! Raqamingiz saqlandi. Endi buyurtma berishingiz mumkin.",
    phone_not_own: "Iltimos, o'zingizning raqamingizni ulashing.",
    balance: "Balansingiz: {b} so'm",
    no_orders: "Sizda hali buyurtma yo'q.",
    orders_head: "Xaridlarim:",
    order_created: "Buyurtmangiz qabul qilindi: {id}\n{title}",
    order_inst_hint: "Admin bilan bog'laning — admin sizni kutmoqda.",
    order_completed: "✅ Buyurtmangiz bajarildi: {id}",
    order_cancelled: "❌ Buyurtmangiz bekor qilindi: {id}",
    refunded: "{a} so'm balansingizga qaytarildi.",
    receipt_ok: "✅ To'lovingiz tasdiqlandi: +{a} so'm. Balans: {b} so'm",
    receipt_no: "❌ Chekingiz rad etildi. Savollar bo'lsa, admin bilan bog'laning.",
    st_queued: "Navbatda", st_completed: "Amalga oshirildi", st_cancelled: "Bekor qilindi",
    write_admin: "✉️ Adminga yozish",
    help: "Buyruqlar:\n/start — xizmatlar\n/balance — balans\n/orders — xaridlarim\n/admin — admin bilan bog'lanish",
    admin_contact: "Admin: @{u}",
  },
  ru: {
    welcome: "Здравствуйте! NAZAROVtggifts — подарки Telegram.\nНажмите кнопку ниже, чтобы выбрать услугу.",
    open: "🎁 Открыть услуги",
    share_phone: "Чтобы оформить заказ, поделитесь номером телефона.",
    share_btn: "📱 Поделиться номером",
    phone_saved: "Спасибо! Номер сохранён. Теперь можно оформлять заказы.",
    phone_not_own: "Пожалуйста, поделитесь своим номером.",
    balance: "Ваш баланс: {b} сум",
    no_orders: "У вас пока нет заказов.",
    orders_head: "Мои покупки:",
    order_created: "Заказ принят: {id}\n{title}",
    order_inst_hint: "Свяжитесь с администратором — он вас ждёт.",
    order_completed: "✅ Заказ выполнен: {id}",
    order_cancelled: "❌ Заказ отменён: {id}",
    refunded: "{a} сум возвращено на баланс.",
    receipt_ok: "✅ Оплата подтверждена: +{a} сум. Баланс: {b} сум",
    receipt_no: "❌ Чек отклонён. Если есть вопросы, напишите администратору.",
    st_queued: "В очереди", st_completed: "Выполнен", st_cancelled: "Отменён",
    write_admin: "✉️ Написать админу",
    help: "Команды:\n/start — услуги\n/balance — баланс\n/orders — мои покупки\n/admin — связаться с админом",
    admin_contact: "Администратор: @{u}",
  },
  en: {
    welcome: "Hello! NAZAROVtggifts — Telegram gifts.\nTap the button below to choose a service.",
    open: "🎁 Open services",
    share_phone: "To place an order, share your phone number.",
    share_btn: "📱 Share number",
    phone_saved: "Thanks! Your number is saved. You can place orders now.",
    phone_not_own: "Please share your own number.",
    balance: "Your balance: {b} UZS",
    no_orders: "You have no orders yet.",
    orders_head: "My purchases:",
    order_created: "Order received: {id}\n{title}",
    order_inst_hint: "Contact the admin — they are waiting for you.",
    order_completed: "✅ Order completed: {id}",
    order_cancelled: "❌ Order cancelled: {id}",
    refunded: "{a} UZS returned to your balance.",
    receipt_ok: "✅ Payment approved: +{a} UZS. Balance: {b} UZS",
    receipt_no: "❌ Your receipt was rejected. Contact the admin if you have questions.",
    st_queued: "In queue", st_completed: "Completed", st_cancelled: "Cancelled",
    write_admin: "✉️ Message the admin",
    help: "Commands:\n/start — services\n/balance — balance\n/orders — my purchases\n/admin — contact the admin",
    admin_contact: "Admin: @{u}",
  },
  zh: {
    welcome: "您好！NAZAROVtggifts — Telegram 礼物。\n点击下方按钮选择服务。",
    open: "🎁 打开服务",
    share_phone: "下单前请分享您的手机号。",
    share_btn: "📱 分享手机号",
    phone_saved: "谢谢！手机号已保存，现在可以下单了。",
    phone_not_own: "请分享您本人的手机号。",
    balance: "您的余额：{b} 苏姆",
    no_orders: "您还没有订单。",
    orders_head: "我的购买：",
    order_created: "订单已受理：{id}\n{title}",
    order_inst_hint: "请联系管理员——管理员正在等您。",
    order_completed: "✅ 订单已完成：{id}",
    order_cancelled: "❌ 订单已取消：{id}",
    refunded: "{a} 苏姆已退回您的余额。",
    receipt_ok: "✅ 付款已确认：+{a} 苏姆。余额：{b} 苏姆",
    receipt_no: "❌ 您的收据被拒绝。如有疑问请联系管理员。",
    st_queued: "排队中", st_completed: "已完成", st_cancelled: "已取消",
    write_admin: "✉️ 联系管理员",
    help: "命令：\n/start — 服务\n/balance — 余额\n/orders — 我的购买\n/admin — 联系管理员",
    admin_contact: "管理员：@{u}",
  },
} as const;

export type Key = keyof (typeof T)["uz"];

export function t(lang: string | null | undefined, k: Key, vars: Record<string, string | number> = {}) {
  const l = (["uz", "ru", "en", "zh"].includes(lang ?? "") ? lang : "uz") as Lang;
  let s: string = T[l][k];
  for (const [n, v] of Object.entries(vars)) s = s.replaceAll(`{${n}}`, String(v));
  return s;
}

export function money(x: number | string, lang = "uz") {
  const loc = { uz: "uz-UZ", ru: "ru-RU", en: "en-US", zh: "zh-CN" }[lang as Lang] ?? "uz-UZ";
  return new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(Number(x));
}
