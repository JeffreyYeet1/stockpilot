import { Form, redirect, type LoaderFunctionArgs } from "react-router";
import styles from "./styles.module.css";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has("shop")) throw redirect(`/app?${url.searchParams}`);
  return null;
}

export default function Home() {
  return <main className={styles.index}>
    <div className={styles.content}>
      <h1>StockPilot</h1>
      <p>Inventory risk and replenishment for Shopify.</p>
      <Form className={styles.form} method="post" action="/auth/login">
        <label className={styles.label}>
          <span>Shop domain</span>
          <input className={styles.input} type="text" name="shop" required placeholder="your-store.myshopify.com" />
        </label>
        <button className={styles.button} type="submit">Open in Shopify</button>
      </Form>
    </div>
  </main>;
}
