# 🧩 Task Panel

**Task Panel** — це легкий локальний таск-менеджер з UI і нагадуваннями.  
Працює як маленька панель, яка відкривається збоку (Windows) або під іконкою в менюбарі (macOS).  
Підходить для швидкого додавання задач, встановлення дедлайнів і отримання нотифікацій.

---

## ✨ Основні можливості

- 📋 Локальні задачі зберігаються у `%AppData%/task-panel/tasks.json` або `~/Library/Application Support/task-panel/`
- ⏰ Нагадування (lead time) та відкладення (**snooze**) із оновленням часу
- 🕒 Автоматичний автозапуск після логіну
- 💼 Групування задач за проектами (з менеджером проектів)
- 🪟 Панель з правого краю екрану (Windows)
- 🍎 Flyout-панель під іконкою в **менюбарі** (macOS)
- 🔔 Нотифікації
- 💾 Дані зберігаються через [`electron-store`](https://github.com/sindresorhus/electron-store)
- 🔑 Гарячі клавіші:
  - `Alt + `` або Ctrl + Alt + T` (Windows)
  - `⌘ + ⌥ + T` (macOS)

---

## 🧰 Технології

- [Electron](https://www.electronjs.org/)
- HTML + CSS + JavaScript (Frontend)
- [`electron-store`](https://github.com/sindresorhus/electron-store)
- [`electron-builder`](https://www.electron.build/) для збірки

---

## 🚀 Запуск у режимі розробки

> Вимагається Node.js v18+ і npm

```bash
git clone https://github.com/myk-d/task-panel.git
cd task-panel
npm install
npm run start
````

### Debug (з логами):

```bash
npm run start:log

Після запуску з’явиться іконка в **системному треї**.
Натисни на неї, щоб відкрити панель із задачами.

---

## 🏗 Збірка готового додатку

npm run build

Після цього буде створено папку `/dist` із готовими файлами:

* **Windows:** `.exe` або `.msi`
* **macOS:** `.dmg` або `.zip`

### macOS специфіка

Якщо хочеш, щоб додаток був **менюбарним** (без іконки в Dock):

```json
// package.json
{
  "build": {
    "appId": "com.myslennya.taskpanel",
    "mac": {
      "category": "public.app-category.productivity",
      "target": ["dmg", "zip"],
      "icon": "icon.png",
      "extendInfo": { "LSUIElement": true }
    }
  }
}
```

---

## 📂 Де зберігаються дані

| ОС          | Шлях                                                  |
| ----------- | ----------------------------------------------------- |
| **Windows** | `%APPDATA%/task-panel/tasks.json`                     |
| **macOS**   | `~/Library/Application Support/task-panel/tasks.json` |

Там же зберігається `projects.json` (список проектів).

> Для переносу або резервного копіювання достатньо скопіювати цю папку.

---

## 🧠 Структура проекту

```
task-panel/
│
├─ main.js           # головний процес (Electron)
├─ preload.cjs       # IPC-мости
├─ index.html        # UI панелі
├─ renderer.js       # логіка інтерфейсу (frontend)
├─ icon.png          # tray-іконка
├─ package.json
└─ README.md
```

---

## 🧩 Приклади

**Додавання задачі:**

```
Fix login bug proj:work +frontend due:2025-10-07
```

**Фільтрація:**

* `proj:work` — задачі певного проекту
* `+frontend` — задачі з тегом
* `due:today` — дедлайн сьогодні
* `overdue` / `next` — швидкі фільтри

---

## 🧷 Особливості macOS

* Панель відкривається під іконкою в менюбарі
* Підтримується прозорий фон і **blur** (через `setVibrancy('sidebar')`)
* Іконка в Dock не показується (`app.setActivationPolicy('accessory')`)
* Нотифікації працюють нативно через Notification API

---

## 🔒 Дані та приватність

* Task Panel **не має хмарної синхронізації**.
* Усі дані зберігаються **локально** на пристрої користувача.
* Ніякої аналітики або телеметрії.

---

## 🧑‍💻 Розробка

Якщо хочеш додати фічу — наприклад:

* інтеграцію з календарем
* імпорт/експорт `.json`
* статистику за тиждень

створи гілку і зроби PR 🚀

---

## 🪪 Ліцензія

MIT © [Mykola Dzoban](https://github.com/myk-d)

---

### 🧠 Ідея

> «Task Panel — це мінімалістична панель задач, яка завжди поруч, але ніколи не заважає.»
