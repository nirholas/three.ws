using System;
using System.Globalization;
using System.Text;

namespace ThreeWs.Sdk.Internal
{
    /// <summary>Builds an escaped path plus query string, skipping unset values.</summary>
    internal sealed class QueryString
    {
        private readonly StringBuilder _sb;
        private bool _first = true;

        public QueryString(string path) => _sb = new StringBuilder(path);

        public QueryString Add(string name, string? value)
        {
            if (value == null) return this;
            _sb.Append(_first ? '?' : '&').Append(Uri.EscapeDataString(name));
            if (value.Length > 0) _sb.Append('=').Append(Uri.EscapeDataString(value));
            _first = false;
            return this;
        }

        public QueryString Add(string name, int? value) => value.HasValue ? Add(name, value.Value.ToString(CultureInfo.InvariantCulture)) : this;

        public QueryString Flag(string name, bool on) => on ? Add(name, "1") : this;

        public override string ToString() => _sb.ToString();
    }
}
