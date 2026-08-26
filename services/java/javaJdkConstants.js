// services/java/javaJdkConstants.js
const fs = require('fs');
const path = require('path');

const JDK_ALWAYS_OK_PREFIXES = ['java.', 'javax.', 'jakarta.', 'sun.', 'jdk.', 'org.w3c.', 'org.xml.'];

let cachedJdkSrcZip = undefined;
function getJdkSrcZip() {
  if (cachedJdkSrcZip !== undefined) return cachedJdkSrcZip;
  try {
    const JdkDetector = require('../appRunner/jdkDetector.js');
    const jdks = JdkDetector.detectAll();
    for (const jdk of jdks) {
      if (jdk.homePath) {
        const p1 = path.join(jdk.homePath, 'lib', 'src.zip');
        const p2 = path.join(jdk.homePath, 'src.zip');
        if (fs.existsSync(p1)) { cachedJdkSrcZip = p1; return p1; }
        if (fs.existsSync(p2)) { cachedJdkSrcZip = p2; return p2; }
      }
    }
  } catch (_) {}
  cachedJdkSrcZip = null;
  return null;
}

const JDK_FQN_MAP = new Map([
  ['UUID', 'java.util.UUID'],
  ['List', 'java.util.List'],
  ['ArrayList', 'java.util.ArrayList'],
  ['LinkedList', 'java.util.LinkedList'],
  ['Map', 'java.util.Map'],
  ['HashMap', 'java.util.HashMap'],
  ['LinkedHashMap', 'java.util.LinkedHashMap'],
  ['TreeMap', 'java.util.TreeMap'],
  ['Set', 'java.util.Set'],
  ['HashSet', 'java.util.HashSet'],
  ['LinkedHashSet', 'java.util.LinkedHashSet'],
  ['TreeSet', 'java.util.TreeSet'],
  ['Collection', 'java.util.Collection'],
  ['Collections', 'java.util.Collections'],
  ['Arrays', 'java.util.Arrays'],
  ['Objects', 'java.util.Objects'],
  ['Optional', 'java.util.Optional'],
  ['OptionalInt', 'java.util.OptionalInt'],
  ['OptionalLong', 'java.util.OptionalLong'],
  ['Date', 'java.util.Date'],
  ['Calendar', 'java.util.Calendar'],
  ['Locale', 'java.util.Locale'],
  ['Properties', 'java.util.Properties'],
  ['Iterator', 'java.util.Iterator'],
  ['Enumeration', 'java.util.Enumeration'],
  ['Queue', 'java.util.Queue'],
  ['Deque', 'java.util.Deque'],
  ['ArrayDeque', 'java.util.ArrayDeque'],
  ['PriorityQueue', 'java.util.PriorityQueue'],
  ['CompletableFuture', 'java.util.concurrent.CompletableFuture'],
  ['ConcurrentHashMap', 'java.util.concurrent.ConcurrentHashMap'],
  ['Future', 'java.util.concurrent.Future'],
  ['Executor', 'java.util.concurrent.Executor'],
  ['ExecutorService', 'java.util.concurrent.ExecutorService'],
  ['Executors', 'java.util.concurrent.Executors'],
  ['Stream', 'java.util.stream.Stream'],
  ['Collectors', 'java.util.stream.Collectors'],
  ['Function', 'java.util.function.Function'],
  ['Consumer', 'java.util.function.Consumer'],
  ['Predicate', 'java.util.function.Predicate'],
  ['Supplier', 'java.util.function.Supplier'],
  ['BiFunction', 'java.util.function.BiFunction'],
  ['LocalDate', 'java.time.LocalDate'],
  ['LocalDateTime', 'java.time.LocalDateTime'],
  ['LocalTime', 'java.time.LocalTime'],
  ['Instant', 'java.time.Instant'],
  ['Duration', 'java.time.Duration'],
  ['Period', 'java.time.Period'],
  ['ZonedDateTime', 'java.time.ZonedDateTime'],
  ['ZoneId', 'java.time.ZoneId'],
  ['BigDecimal', 'java.math.BigDecimal'],
  ['BigInteger', 'java.math.BigInteger'],
  ['File', 'java.io.File'],
  ['InputStream', 'java.io.InputStream'],
  ['OutputStream', 'java.io.OutputStream'],
  ['FileInputStream', 'java.io.FileInputStream'],
  ['FileOutputStream', 'java.io.FileOutputStream'],
  ['Reader', 'java.io.Reader'],
  ['Writer', 'java.io.Writer'],
  ['BufferedReader', 'java.io.BufferedReader'],
  ['BufferedWriter', 'java.io.BufferedWriter'],
  ['InputStreamReader', 'java.io.InputStreamReader'],
  ['OutputStreamWriter', 'java.io.OutputStreamWriter'],
  ['ByteArrayInputStream', 'java.io.ByteArrayInputStream'],
  ['ByteArrayOutputStream', 'java.io.ByteArrayOutputStream'],
  ['PrintStream', 'java.io.PrintStream'],
  ['Serializable', 'java.io.Serializable'],
  ['IOException', 'java.io.IOException'],
  ['Path', 'java.nio.file.Path'],
  ['Paths', 'java.nio.file.Paths'],
  ['Files', 'java.nio.file.Files'],
  ['URI', 'java.net.URI'],
  ['URL', 'java.net.URL'],
  ['HttpClient', 'java.net.http.HttpClient'],
  ['HttpRequest', 'java.net.http.HttpRequest'],
  ['HttpResponse', 'java.net.http.HttpResponse'],
  ['String', 'java.lang.String'],
  ['Object', 'java.lang.Object'],
  ['Integer', 'java.lang.Integer'],
  ['Long', 'java.lang.Long'],
  ['Double', 'java.lang.Double'],
  ['Float', 'java.lang.Float'],
  ['Boolean', 'java.lang.Boolean'],
  ['Byte', 'java.lang.Byte'],
  ['Short', 'java.lang.Short'],
  ['Character', 'java.lang.Character'],
  ['CharSequence', 'java.lang.CharSequence'],
  ['Number', 'java.lang.Number'],
  ['Comparable', 'java.lang.Comparable'],
  ['Iterable', 'java.lang.Iterable'],
  ['Exception', 'java.lang.Exception'],
  ['RuntimeException', 'java.lang.RuntimeException'],
  ['IllegalArgumentException', 'java.lang.IllegalArgumentException'],
  ['IllegalStateException', 'java.lang.IllegalStateException'],
  ['NullPointerException', 'java.lang.NullPointerException'],
  ['StringBuilder', 'java.lang.StringBuilder'],
  ['StringBuffer', 'java.lang.StringBuffer'],
  ['System', 'java.lang.System'],
  ['Thread', 'java.lang.Thread'],
  ['Class', 'java.lang.Class'],
  ['Enum', 'java.lang.Enum'],
  ['Record', 'java.lang.Record'],
  ['Void', 'java.lang.Void'],
  ['AutoCloseable', 'java.lang.AutoCloseable'],
  ['Cloneable', 'java.lang.Cloneable'],
  ['Runnable', 'java.lang.Runnable'],
  ['Override', 'java.lang.Override'],
  ['Deprecated', 'java.lang.Deprecated'],
  ['SuppressWarnings', 'java.lang.SuppressWarnings']
]);

module.exports = {
  JDK_ALWAYS_OK_PREFIXES,
  JDK_FQN_MAP,
  getJdkSrcZip,
};
