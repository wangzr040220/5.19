import os
import json
import requests
from flask import Flask, render_template, request, jsonify, session
import mysql.connector
from dotenv import load_dotenv
from itertools import cycle
from datetime import datetime
from collections import deque

# 加载环境变量
load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)  # 设置session密钥

# 配置MySQL连接
mysql_config = {
    'host': os.getenv('MYSQL_HOST', 'localhost'),
    'user': os.getenv('MYSQL_USER', 'root'),
    'password': os.getenv('MYSQL_PASSWORD', 'wangzr040220'),
    'database': os.getenv('MYSQL_DATABASE', '5.18')
}

# API密钥池
API_KEYS = [
    "sk-ubvomjinyzvfjygtkkotivseoxdmhtzyapqwgajaljzloulp",
    "sk-wkyeffkowpzruolrmynwyidmuqcacfytkdftjvfynbefsxvs",
    "sk-inukgfljduvaulgfexnlnvwrxdjhpfnyltimypnictgduhcm",
    "sk-rrwnvjadkzlpmynpvuhurrizqtwhoyqkqzelfrzliiokqbry",
    "sk-goqpyxqfomqpsaiulhkvstuczrlquciuutthaambnrtcgprl",
    "sk-omifhbznpmyiybjenmplsknuwkukfghrnmaxaglduxmumsfq",
    "sk-zwrobvifmzrsbobnwxacnfzujhdsqhlzdioetcghjwghhmne",
    "sk-ijozcsodkjlvesjhqbfswnubjihophnhertmjbczarfvkyxi",
    "sk-voflyoslxoabluntmvvnldgbwqsxjkzufcqxwxzimudkngtb",
    "sk-kqwymmfizxvjjduswsmquxhdkqtzfnbofkjbuntbvtwlludu",
    "sk-fgfeosjaykwbglyplijlwbdzcdghyyekaqnnyfrgasodchpf",
    "sk-obfpljksefbxrqrusuzvghzsrwyyqctckqkvhvicrgczuksc",
    "sk-qgovqjyohktobehqdbyzbxdxxcvskvrjhsofsrkkkbpvmfwa",
    "sk-zreqvnrvtyleigudtjkwdvwgxbekbnzlasvvivqfcchwvvej",
    "sk-qyxtphjthmywzxzahpcvrwvtagwauaknimqvftagqhjbqiok",
    "sk-kywparzgjdarzjemuckmbcqjokkrbjoeoaewpofswwugivin",
    "sk-gdavktmjewgzfpxlohyhfouppcqxsmhqxfwnymguwjbzhmas",
    "sk-ytkvonhkbaamofmrymxvzmfcbmngmblxbcntcxsiacojdtbv",
    "sk-zdiqrlzmavsdxtqdykknndonnwwpsapetxuuxbvxypbyisma",
    "sk-dvveuxvhzvfqxafvrsytjhfgfjqhqkphbofbwqxxrqmbispu",
    "sk-jskgnrpupagrrblvnhbhuqkxajikrsbkrpcyuxupcoevxckt"
]

# 创建一个无限循环的密钥迭代器
api_key_cycle = cycle(API_KEYS)

class Conversation:
    def __init__(self, max_history=30):
        self.history = []
        self.max_history = max_history
        self.current_sql = None
        self._schema_info = None
    
    @property
    def schema_info(self):
        if self._schema_info is None:
            self._schema_info = get_database_schema()
        return self._schema_info
    
    def add_message(self, role, content, sql=None):
        self.history.append({
            "role": role,
            "content": content,
            "sql": sql,
            "timestamp": datetime.now().isoformat()
        })
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
        if sql:
            self.current_sql = sql
    
    def get_context(self):
        return self.history
    
    def clear(self):
        self.history = []
        self.current_sql = None
    
    @classmethod
    def from_dict(cls, data):
        conversation = cls(max_history=data.get('max_history', 30))
        conversation.history = data.get('history', [])
        conversation.current_sql = data.get('current_sql')
        return conversation
    
    def to_dict(self):
        return {
            'max_history': self.max_history,
            'history': self.history,
            'current_sql': self.current_sql
        }

def get_next_api_key():
    """获取下一个API密钥"""
    return next(api_key_cycle)

def try_api_request(payload, max_retries=len(API_KEYS)):
    """尝试使用不同的API密钥发送请求，直到成功或尝试所有密钥"""
    # 修改payload以符合API要求
    api_payload = {
        "model": "Qwen/QwQ-32B",
        "messages": payload["messages"],
        "temperature": payload.get("temperature", 0.7),
        "max_tokens": payload.get("max_tokens", 512),
        "stream": False
    }

    for _ in range(max_retries):
        current_api_key = get_next_api_key()
        headers = {
            "Authorization": f"Bearer {current_api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                "https://api.siliconflow.cn/v1/chat/completions", 
                json=api_payload, 
                headers=headers,
                timeout=(30, 120)  # 连接超时30秒，读取超时120秒
            )
            
            if response.status_code == 200:
                return response.json()
            
            print(f"API请求失败 (密钥: {current_api_key[:10]}...): {response.status_code}, {response.text}")
            
        except requests.exceptions.RequestException as e:
            print(f"请求异常 (密钥: {current_api_key[:10]}...): {str(e)}")
            continue
    
    return None

def get_database_schema():
    """获取数据库表结构信息"""
    try:
        conn = mysql.connector.connect(**mysql_config)
        cursor = conn.cursor()
        
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        
        schema_info = []
        for table in tables:
            table_name = table[0]
            cursor.execute(f"DESCRIBE {table_name}")
            columns = cursor.fetchall()
            
            column_info = []
            for col in columns:
                column_info.append({
                    "name": col[0],
                    "type": col[1],
                    "key": col[3],
                    "default": col[4]
                })
            
            cursor.execute(f"SELECT table_comment FROM information_schema.tables WHERE table_schema = '{mysql_config['database']}' AND table_name = '{table_name}'")
            table_comment_result = cursor.fetchone()
            table_comment = table_comment_result[0] if table_comment_result else ""
            
            cursor.execute(f"SELECT column_name, column_comment FROM information_schema.columns WHERE table_schema = '{mysql_config['database']}' AND table_name = '{table_name}'")
            column_comments = {row[0]: row[1] for row in cursor.fetchall()}
            
            for col in column_info:
                col["comment"] = column_comments.get(col["name"], "")
            
            schema_info.append({
                "table_name": table_name,
                "table_comment": table_comment,
                "columns": column_info
            })
        
        cursor.close()
        conn.close()
        return schema_info
    except Exception as e:
        print(f"获取数据库结构时出错: {e}")
        return []

def validate_sql(sql_query, schema_info):
    """验证SQL语句的正确性"""
    try:
        # 解析SQL中使用的表名和列名
        sql_upper = sql_query.upper()
        words = sql_upper.split()
        
        # 获取所有表名和列名的映射
        table_columns = {
            table['table_name'].upper(): [col['name'].upper() for col in table['columns']]
            for table in schema_info
        }
        
        # 检查FROM子句中的表名
        if 'FROM' in words:
            from_index = words.index('FROM')
            table_name = words[from_index + 1].strip('();,')
            if table_name not in table_columns:
                return False, f"错误：表 '{table_name}' 不存在"
        
        # 检查JOIN子句中的表名
        join_keywords = ['JOIN', 'INNER', 'LEFT', 'RIGHT']
        for i, word in enumerate(words):
            if word in join_keywords and i + 1 < len(words):
                table_name = words[i + 1].strip('();,')
                if table_name not in table_columns:
                    return False, f"错误：表 '{table_name}' 不存在"
        
        # 检查SELECT子句中的列名
        if 'SELECT' in words:
            select_index = words.index('SELECT')
            from_index = words.index('FROM')
            columns_part = ' '.join(words[select_index + 1:from_index])
            
            # 处理 SELECT *
            if '*' in columns_part:
                return True, "验证通过"
                
            columns = [c.strip().split('.')[-1].strip('();,') for c in columns_part.split(',')]
            main_table = words[from_index + 1].strip('();,')
            
            for col in columns:
                # 跳过聚合函数和表达式
                if any(func in col for func in ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'AS']):
                    continue
                    
                # 检查列是否存在于主表中
                if col not in table_columns.get(main_table, []) and col != '*':
                    # 检查其他相关表
                    col_found = False
                    for table_cols in table_columns.values():
                        if col in table_cols:
                            col_found = True
                            break
                    if not col_found:
                        return False, f"错误：列 '{col}' 不存在于查询相关的表中"
        
        return True, "验证通过"
    except Exception as e:
        return False, f"SQL验证出错: {str(e)}"

def analyze_query_and_generate_sql(query, conversation):
    """分析用户查询并生成SQL"""
    try:
        schema_description = ""
        for table in conversation.schema_info:
            schema_description += f"表名: {table['table_name']}"
            if table['table_comment']:
                schema_description += f" (描述: {table['table_comment']})"
            schema_description += "\n列:\n"
            
            for column in table['columns']:
                schema_description += f"  - {column['name']} ({column['type']})"
                if column['key'] == 'PRI':
                    schema_description += " (主键)"
                if column['comment']:
                    schema_description += f" (描述: {column['comment']})"
                schema_description += "\n"
            schema_description += "\n"

        # 构建对话历史
        messages = [
            {
                "role": "system",
                "content": f"""你是一个数据分析助手，请帮助用户分析查询需求并生成SQL查询语句。
以下是数据库结构:

{schema_description}

请按照以下格式回复：
1. 需求分析：分析用户的查询需求
2. 查询方案：说明如何通过SQL实现该需求
3. SQL语句：给出具体的SQL查询语句（使用```sql 和 ``` 包裹SQL语句）
4. 确认提示：询问用户是否执行该查询

注意事项：
- 表中使用recent_Chg_Date字段作为最近更改日期
- 表中使用ecc_Stat字段表示状态
- 所有字段名都区分大小写，请严格按照表结构中的字段名使用
- 生成SQL时必须使用正确的表名和列名"""
            }
        ]
        
        # 添加对话历史
        for msg in conversation.get_context()[-5:]:  # 只使用最近5条对话作为上下文
            messages.append({"role": msg["role"], "content": msg["content"]})
        
        # 添加当前查询
        messages.append({"role": "user", "content": query})

        payload = {
            "messages": messages,
            "max_tokens": 1024,
            "temperature": 0.7,
            "top_p": 0.9
        }
        
        response_json = try_api_request(payload)
        
        if response_json:
            response_text = response_json['choices'][0]['message']['content'].strip()
            
            # 提取SQL语句
            sql_query = None
            if "```sql" in response_text:
                sql_parts = response_text.split("```sql")
                sql_query = sql_parts[1].split("```")[0].strip()
                
                # 验证SQL语句
                if sql_query:
                    is_valid, message = validate_sql(sql_query, conversation.schema_info)
                    if not is_valid:
                        # 如果验证失败，添加错误信息到响应中
                        response_text += f"\n\n⚠️ SQL验证失败：{message}\n请检查SQL语句是否正确，或尝试重新描述您的需求。"
                        sql_query = None
            
            return response_text, sql_query
        else:
            return "抱歉，我暂时无法处理您的请求。请稍后再试。", None
            
    except Exception as e:
        print(f"分析查询时出错: {e}")
        return f"处理查询时发生错误: {str(e)}", None

def analyze_results(results, conversation):
    """分析查询结果"""
    try:
        messages = [
            {
                "role": "system",
                "content": "你是一个数据分析助手。请分析SQL查询的结果，并用通俗易懂的语言向用户解释查询结果的含义。"
            }
        ]
        
        # 添加当前SQL和结果信息
        result_str = json.dumps(results, ensure_ascii=False, indent=2)
        messages.append({
            "role": "user",
            "content": f"""请分析以下SQL查询结果并给出解释：
SQL查询：{conversation.current_sql}
查询结果：{result_str}"""
        })

        payload = {
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.7,
            "top_p": 0.9
        }
        
        response_json = try_api_request(payload)
        
        if response_json:
            return response_json['choices'][0]['message']['content'].strip()
        else:
            return "抱歉，我暂时无法分析查询结果。请您自行查看结果数据。"
            
    except Exception as e:
        print(f"分析结果时出错: {e}")
        return f"分析结果时发生错误: {str(e)}"

def execute_sql_query(sql_query):
    """执行SQL查询并返回结果"""
    try:
        conn = mysql.connector.connect(**mysql_config)
        cursor = conn.cursor(dictionary=True)
        
        cursor.execute(sql_query)
        results = cursor.fetchall()
        
        cursor.close()
        conn.close()
        return results
    except Exception as e:
        print(f"执行SQL查询时出错: {e}")
        return {"error": str(e)}

@app.route('/')
def index():
    if 'conversation' not in session:
        conversation = Conversation()
        session['conversation'] = conversation.to_dict()
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    print("收到请求:", request.json)
    data = request.json
    user_input = data.get('message', '')
    action = data.get('action', 'analyze')  # 'analyze' 或 'confirm'
    
    if 'conversation' not in session:
        print("创建新会话")
        conversation = Conversation()
    else:
        print("加载现有会话")
        conversation = Conversation.from_dict(session['conversation'])
    
    if action == 'analyze':
        print("执行分析操作")
        # 分析查询并生成SQL
        response_text, sql_query = analyze_query_and_generate_sql(user_input, conversation)
        print("生成的SQL:", sql_query)
        
        conversation.add_message("user", user_input)
        conversation.add_message("assistant", response_text, sql_query)
        
        # 保存会话状态
        session['conversation'] = conversation.to_dict()
        print("会话已更新")
        
        return jsonify({
            "response": response_text,
            "sql": sql_query,
            "needConfirmation": True if sql_query else False
        })
    
    elif action == 'confirm':
        print("执行确认操作")
        # 执行SQL查询并分析结果
        if not conversation.current_sql:
            print("错误：没有可执行的SQL查询")
            return jsonify({"error": "没有可执行的SQL查询"})
        
        print("执行SQL查询:", conversation.current_sql)
        results = execute_sql_query(conversation.current_sql)
        
        if isinstance(results, dict) and "error" in results:
            print("查询执行错误:", results["error"])
            return jsonify({"error": f"执行查询时出错: {results['error']}"})
        
        print("查询结果:", results)
        # 分析查询结果
        analysis = analyze_results(results, conversation)
        conversation.add_message("assistant", analysis)
        
        # 保存会话状态
        session['conversation'] = conversation.to_dict()
        print("会话已更新，返回结果")
        
        return jsonify({
            "response": analysis,
            "results": results,
            "needConfirmation": False
        })

@app.route('/clear', methods=['POST'])
def clear_conversation():
    if 'conversation' in session:
        conversation = Conversation()
        session['conversation'] = conversation.to_dict()
    return jsonify({"status": "success"})

if __name__ == '__main__':
    app.run(debug=True, port=5001) 