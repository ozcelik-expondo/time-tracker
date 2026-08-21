const { toJiraWorklog } = require('./worklog-adapter');

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function getConfigurationErrorMessage() {
  return 'Jira sync is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.';
}

function parseErrorMessage(bodyText, status) {
  if (!bodyText) {
    return `Jira request failed with status ${status}.`;
  }

  try {
    const parsed = JSON.parse(bodyText);

    if (typeof parsed.errorMessage === 'string' && parsed.errorMessage.length > 0) {
      return parsed.errorMessage;
    }

    if (Array.isArray(parsed.errorMessages) && parsed.errorMessages.length > 0) {
      return parsed.errorMessages.join(', ');
    }

    if (typeof parsed.message === 'string' && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch (error) {
    return bodyText;
  }

  return `Jira request failed with status ${status}.`;
}

function createJiraClient({
  baseUrl,
  email,
  apiToken,
  fetchImpl = globalThis.fetch
}) {
  const normalizedBaseUrl = typeof baseUrl === 'string' && baseUrl.length > 0
    ? trimTrailingSlashes(baseUrl)
    : '';
  const isConfigured = Boolean(normalizedBaseUrl && email && apiToken);

  return {
    isConfigured,

    async sendWorklog(session) {
      if (!isConfigured) {
        throw new Error(getConfigurationErrorMessage());
      }

      const { issueKey, payload } = toJiraWorklog(session);
      const url = `${normalizedBaseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`;
      const response = await fetchImpl(
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );
      const bodyText = typeof response.text === 'function' ? await response.text() : '';

      if (!response.ok) {
        throw new Error(parseErrorMessage(bodyText, response.status));
      }

      if (!bodyText) {
        return null;
      }

      try {
        return JSON.parse(bodyText);
      } catch (error) {
        return bodyText;
      }
    }
    ,

    async getIssueSummary(issueKey) {
      if (!isConfigured) {
        throw new Error(getConfigurationErrorMessage());
      }

      const url = `${normalizedBaseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary`;
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`
        }
      });

      const bodyText = typeof response.text === 'function' ? await response.text() : '';

      if (!response.ok) {
        throw new Error(parseErrorMessage(bodyText, response.status));
      }

      try {
        const parsed = JSON.parse(bodyText);
        return parsed?.fields?.summary ?? null;
      } catch (error) {
        throw new Error(`Jira response for ${issueKey} could not be parsed as JSON.`);
      }
    }
  };
}

module.exports = {
  createJiraClient,
  getConfigurationErrorMessage
};