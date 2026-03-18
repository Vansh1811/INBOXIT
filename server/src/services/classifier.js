// Rules-based first, GPT-4o-mini fallback
const classify = (from = "", subject = "") => {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();

  if (
    f.match(/naukri|linkedin|internshala|wellfound|freshers|hirist|instahyre/) ||
    s.match(/job|hiring|interview|offer letter|application|recruiter/)
  ) return "jobs";

  if (
    f.match(/swiggy|zomato|dominos|mcdonalds|blinkit|dunzo|bigbasket/) ||
    s.match(/order|delivered|receipt|delivery|your food/)
  ) return "food";

  if (
    f.match(/uber|ola|rapido|indigo|airasia|irctc/) ||
    s.match(/trip receipt|ride|booking confirmation|ticket|pnr/)
  ) return "cabs";

  if (
    f.match(/hdfcbank|sbibank|icicibank|axisbank|kotak|paytm|phonepe|razorpay/) ||
    s.match(/statement|otp|transaction|invoice|payment|credited|debited/)
  ) return "finance";

  if (
    f.match(/apollo|1mg|practo|pharmeasy|tata health/) ||
    s.match(/prescription|appointment|medicine|health|report/)
  ) return "health";

  if (
    f.match(/linkedin|instagram|twitter|github|facebook|youtube/) ||
    s.match(/mentioned you|commented|new follower|connection request/)
  ) return "social";

  return null; // no rule matched → LLM fallback
};

module.exports = { classify };
