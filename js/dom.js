export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) return;

    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        node.dataset[dataKey] = dataValue;
      });
    } else {
      node.setAttribute(key, value);
    }
  });

  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null || child === false) return;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });

  return node;
}

export function profileDisplayName(profile, fallback = "User") {
  return profile?.full_name || profile?.["full name"] || profile?.username || fallback;
}

export function profileAvatar(profile, fallback = "") {
  return profile?.avatar_url || profile?.["avatar url"] || fallback;
}

export function isValidUsername(value) {
  return /^[A-Za-z0-9_]{3,24}$/.test(value || "");
}

export function isValidAge(value) {
  return Number.isInteger(value) && value >= 18 && value <= 100;
}

export function isValidGender(value) {
  return value === "male" || value === "female";
}
