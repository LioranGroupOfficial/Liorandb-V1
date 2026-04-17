# LioranDB

![LioranDB Social Card](./static/img/liorandb-social-card.jpg)

---

## 📖 Documentation & Community

* 📚 **Docs:** [https://db.lioransolutions.com](https://db.lioransolutions.com)
* 💬 **Discord:** [https://discord.gg/WsWWThjPMp](https://discord.gg/WsWWThjPMp)
* 📧 **Contact:** [contact@lioransolutions.com](mailto:contact@lioransolutions.com)

---

## 📦 Installation

```bash
npm i @liorandb/core
```

---

## ⚡ Getting Started

```ts
import { LioranManager } from "@liorandb/core";

async function main() {
  const db = new LioranManager({
    root: "./db"
  });

  await db.init();

  await db.collection("users").insert({
    id: 1,
    name: "John Doe",
    age: 25
  });

  const users = await db.collection("users").find({});

  console.log(users);
}

main();
```

---

## ✅ Output

```bash
[
  {
    id: 1,
    name: "John Doe",
    age: 25
  }
]
```

---

## 📄 License

**LIORANDB License**
