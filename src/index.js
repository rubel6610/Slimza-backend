import http from "k6/http";
import { check, sleep } from "k6";

const WEB = __ENV.WEB || "http://localhost:5173/Api";


export const options = {
  stages: [
    { duration: "2m", target: 100 },   // ধীরে ধীরে ১০০ জন
    { duration: "5m", target: 500 },
    { duration: "5m", target: 1000 },
    { duration: "5m", target: 2000 },  // পিক
    { duration: "2m", target: 0 },     // নামিয়ে আনা
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],    // ১%-এর কম error
    http_req_duration: ["p(95)<800"],  // ৯৫% রিকোয়েস্ট ০.৮ সেকেন্ডের মধ্যে
  },
};

// একজন সাধারণ ভিজিটর যা করে
export default function () {
  check(http.get(`${WEB}/`), { "home 200": (r) => r.status === 200 });
  sleep(2);
  check(http.get(`${WEB}/shop`), { "shop 200": (r) => r.status === 200 });
  sleep(2);
  check(http.get(`${WEB}/shop/slimza-detox-elixir`), { "product 200": (r) => r.status === 200 });
  sleep(3);
}
